const qiniu = require("qiniu");
const fs = require('fs')
const moment = require('moment')
const _array = require('lodash/array');
const _difference = require('lodash/difference')
const crypto = require('crypto');

const qiniuConfig = require('./qiniu.config.js')
//需要填写你的 Access Key 和 Secret Key
let config = new qiniu.conf.Config();
config.zone = qiniu.zone[qiniuConfig.zone];
qiniu.conf.RPC_TIMEOUT = 600000;

let mac = new qiniu.auth.digest.Mac(qiniuConfig.accessKey, qiniuConfig.secretKey);


let argvArr = process.argv.slice(2)
if (argvArr.length === 0) {
	let env = Object.keys(qiniuConfig.envConfig).join(' or ');
	console.log(`请在命令后添加 ${env}`)
	process.exit()
}
let bucket = qiniuConfig.envConfig[argvArr[0]].bucket;
let cdn = qiniuConfig.envConfig[argvArr[0]].cdnHost;

let { originPath, oldOriginPath, originFile, fileEncodeType = 'utf8', qndataFile = 'qndata.json', failedUploadLog = 'failedlog.json' } = qiniuConfig;


let fileCount = 0, compareFileCount = 0, uploadCount = 0;
let debugFlag = false, initFirst = false, allUploadIsSuccess = true, allRefreshIsSuccess = true;
let failedObj = {
	uploadFiles: {},
	refreshArr: []
}, needUpload = [], qndata = {}, qndataLog = {};


//将fs.stat和fs.readdir转换成promise的工具函数
let makePromiseUtil = (fn) => {
	return (...args) => {
		return new Promise((resolve, reject) => {
			[].push.call(args, (err, ret) => {
				if (err) {
					reject(err)
				} else {
					resolve(ret)
				}
			})
			fn.apply(null, args)
		})
	}
};

let statPromise = makePromiseUtil(fs.stat)
let readdirPromise = makePromiseUtil(fs.readdir);

try {
	let statInstance = fs.statSync(qndataFile)
	if (statInstance.isFile()) {
		qndata = JSON.parse(fs.readFileSync(qndataFile, fileEncodeType));
	}
} catch (err) {
	if (err && err.code !== 'ENOENT') {
		console.error(err)
	} else {
		initFirst = true
	}
}

//构建上传策略函数
let uptoken = (bucket, key) => {
	let options = {
		scope: bucket + ":" + key
	}
	let putPolicy = new qiniu.rs.PutPolicy(options);
	return putPolicy.uploadToken(mac);
}


//构造上传函数
let uploadFile = (uptoken, key, localFile) => {
	let formUploader = new qiniu.form_up.FormUploader(config);
	let putExtra = new qiniu.form_up.PutExtra();
	formUploader.putFile(uptoken, key, localFile, putExtra, function (err, respBody, respInfo) {
		if (err) {
			allUploadIsSuccess = false
			failedObj.uploadFiles[key] = new moment().format('YYYY-MM-DD HH:mm:ss')
			console.log(key + ' upload failed')
			debugFlag && console.error(err)
		} else if (respInfo.statusCode == 200) {
			// console.log('success')
			// console.log(ret)
			// 上传成功， 处理返回值
			// console.log(ret.hash, ret.key, ret.persistentId);
		} else {
			console.log(respInfo.statusCode);
			console.log(respBody);
		}
		uploadCount++;
		if (uploadCount === needUpload.length) {
			dealFileQN()

		}
	});
}
//处理上传失败的文件
let dealFailedFiles = () => {
	let failObj = JSON.parse(fs.readFileSync(failedUploadLog, fileEncodeType));
	needUpload = Object.keys(failObj.uploadFiles)
	qndataLog = qndata;
	needUpload.forEach((item) => {
		qndataLog[item] = new moment().format('YYYY-MM-DD HH:mm:ss')
	})
	qndata = {}
	needUpload = needUpload.map(it => originPath + '/' + it)
	uploadFilesByArr(needUpload)
	refreshCDN(_difference(failObj.refreshArr, needUpload))
}
//全部文件上传完成后根据日志对七牛云上的数据做处理 删除 --> 刷新
let dealFileQN = () => {
	allUploadIsSuccess && console.log('all file is upload successful')
	let bucketManager = new qiniu.rs.BucketManager(mac, config);
	let qndataKeys = Object.keys(qndata);
	let qndataKeysLength = qndataKeys.length;
	let allFileIsSuccess = true
	let deleteOperations = []
	if (qndataKeysLength !== 0) {
		//每个operations的数量不可以超过1000个，如果总数量超过1000，需要分批发送
		qndataKeys.forEach((key) => {
			deleteOperations.push(qiniu.rs.deleteOp(bucket, key))
		})
		console.log('deleting %s files on CDN', qndataKeys.length)
		bucketManager.batch(deleteOperations, function (err, respBody, respInfo) {
			// console.log(respBody)
			if (err) {
				debugFlag && console.error(err);
				//throw err;
			} else {
				// 200 is success, 298 is part success
				if (parseInt(respInfo.statusCode / 100) == 2) {
					respBody.forEach(function (item) {
						if (item.code !== 200) {
							allFileIsSuccess = false
							console.error(item);
						}
					});
					if (allFileIsSuccess) {
						console.log('all extra file is deleted form qiniuCloud successful')

					} else {
						debugFlag && console.error('some deleted is failed')
					}
				} else {
					debugFlag && console.log(respInfo.deleteusCode);
					debugFlag && console.log(respBody);
				}
			}
			// writeQnlog()
			refreshCDN(needUpload);
		});
		// deleteKeys(qndataKeys)
	} else {
		console.log('there is not have extra file need to delete')
		if (initFirst) {
			writeQnlog()
		} else {
			refreshCDN(needUpload);
		}
	}

}
let writeQnlog = () => {
	if (!allUploadIsSuccess || !allRefreshIsSuccess) {
		for (let key in failedObj.uploadFiles) {
			delete qndataLog[key]
		}
		fs.writeFile(failedUploadLog, JSON.stringify(failedObj), 'utf8', (err) => {
			if (err) {
				debugFlag && console.error(err)
			} else {
				console.log('失败日志已写入' + failedUploadLog + '，请运行 npm run upload2qiniu ' + argvArr[0] + ' failed 重新' + (allUploadIsSuccess ? '' : '上传') + (allRefreshIsSuccess ? '' : '刷新'))
			}

		});
	}
	fs.writeFile(qndataFile, JSON.stringify(qndataLog), 'utf8', (err) => {
		if (err) {
			console.log('write qiniu.json is failed')
			debugFlag && console.error(err)
		} else {
			console.log('write qiniu.json is success')
		}

	});

}
//刷新cdn缓存，否则需要很久才生效，但限额500/天，坑爹。。
let refreshCDN = (needRefreshArr) => {
	console.log('refreshing CDN...')
	let cdnManager = new qiniu.cdn.CdnManager(mac);
	//刷新链接，单次请求链接不可以超过100个，如果超过，请分批发送请求
	needRefreshArr = _array.chunk(needRefreshArr, 100);
	needRefreshArr.forEach((item, index) => {
		item = item.map((it) => {
			return cdn + it.replace('dist/', '')
		})
		cdnManager.refreshUrls(item, function (err, respBody, respInfo) {
			if (err) {
				console.log('刷新cdn出错...')
				allRefreshIsSuccess = false
				failedObj.refreshArr = failedObj.refreshArr.concat(item.map(it => it.replace(cdn, '')))
				debugFlag && console.error(err);
			}
			if (respInfo.statusCode == 200) {
				// let jsonBody = JSON.parse(respBody);
				// console.log(jsonBody);
			}
			if (index === needRefreshArr.length - 1) {
				writeQnlog()
			}
		});
	})
}
//给定文件地址，判断跟旧文件是否相同
let compareFile = (path) => {
	let oldPath = path.replace(originPath, oldOriginPath);
	let newHash = '', oldHash = '';
	let newHashHandle, oldHashHandle, newRS, oldRS;
	if (initFirst) {
		//如果是第一次运行该程序，则所有文件都需要上传
		_compareFile(path, 1, 2)
	} else {
		try {
			fs.statSync(oldPath)
			newHashHandle = crypto.createHash('md5');
			oldHashHandle = crypto.createHash('md5');
			newRS = fs.createReadStream(__dirname + '/' + path);
			oldRS = fs.createReadStream(__dirname + '/' + oldPath);
			newRS.on('data', newHashHandle.update.bind(newHashHandle));
			newRS.on('end', function () {
				newHash = newHashHandle.digest('hex');
				_compareFile(path, newHash, oldHash)
			});
			oldRS.on('data', oldHashHandle.update.bind(oldHashHandle));
			oldRS.on('end', function () {
				oldHash = oldHashHandle.digest('hex');
				_compareFile(path, newHash, oldHash)
			});
		} catch (err) {
			if (err && err.code == 'ENOENT') {
				//如果旧文件中没有对应文件，则该文件需要上传
				_compareFile(path, 1, 2)
			}
		}
	}
}
let _compareFile = (key, newHash, oldHash) => {
	if (newHash !== '' && oldHash !== '') {
		compareFileCount++;
		if (newHash !== oldHash) {
			needUpload.push(key)
		}
		if (compareFileCount === fileCount) {
			console.log('Uploading %s files...', needUpload.length)
			uploadFilesByArr(needUpload)
		}
	}
}
let uploadFilesByArr = (arr) => {
	arr.forEach((path) => {
		//要上传文件的本地路径
		let filePath = path;
		//上传到七牛后保存的文件名
		const localFilePathHeaderName = qiniuConfig.originPath
		const qiniuFileStorePath = qiniuConfig.storePath
		let key = path.replace(localFilePathHeaderName + '/', qiniuFileStorePath + '/');
		//生成上传 Token
		let token = uptoken(bucket, key);

		//调用uploadFile上传
		uploadFile(token, key, filePath);
	})
}


let readFilesFormDir = (dir) => {
	return statPromise(dir).then((stats) => {
		let ret;
		if (stats.isDirectory()) {
			ret = !/[/]php$/.test(dir) && readdirPromise(dir).then((files) => {
				return Promise.all(files.map(file => readFilesFormDir(dir + '/' + file)))
			}).then((paths) => {
				return [].concat(...paths)
			})
			ret = ret || []
		} else if (stats.isFile()) {
			ret = dir
		}
		return ret
	})
}

if (argvArr.length === 1 || (argvArr.length === 2 && argvArr[1] === 'debug')) {
	argvArr.length === 2 && argvArr[1] === 'debug' && (debugFlag = true)
	readFilesFormDir(originPath).then((paths) => {
		fileCount = paths.length;
		console.log('comparing %s files...', fileCount)
		paths.forEach((path) => {
			let key = path.match(new RegExp('^' + originPath + '[/](.*)$'))[1];
			if (qndata[key]) {
				delete qndata[key]
			}
			qndataLog[key] = new moment().format('YYYY-MM-DD HH:mm:ss')
			compareFile(path)
		})

	})
	//改变index.html中的文件引用
	fs.readFile(originPath + '/' + originFile, fileEncodeType, (err, data) => {
		if (err) throw err;
		data = data.replace(/((href=['"])|(src=['"]))(?!http:)(?!https:)[/]?([^/])/g, '$1' + cdn + '$4');
		// console.log(data);
		fs.writeFile(originPath + '/' + originFile, data, (err) => {
			if (err) throw err;
			console.log('index.html is change success');
		});
	});
} else if (argvArr[1] === 'failed') {
	debugFlag = true
	dealFailedFiles()
} else {
	console.log('命令行参数不合法')
}
