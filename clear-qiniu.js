const qiniu = require("qiniu");
const _array = require('lodash/array');
const qiniuConfig = require('./qiniu.config.js')

let mac = new qiniu.auth.digest.Mac(qiniuConfig.accessKey, qiniuConfig.secretKey);
let config = new qiniu.conf.Config();

config.zone = qiniu.zone[qiniuConfig.zone];
let bucketManager = new qiniu.rs.BucketManager(mac, config);


let argvArr = process.argv.slice(2)
if (argvArr.length === 0) {
	let env = Object.keys(qiniuConfig.envConfig).join(' or ');
	console.log(`请在命令后添加 ${env}`)
    process.exit()
}
let bucket = qiniuConfig.envConfig[argvArr[0]].bucket;


let getDeleteListPromise = (bucket, marker, preItems) => {
    // @param options 列举操作的可选参数
    //                prefix    列举的文件前缀
    //                marker    上一次列举返回的位置标记，作为本次列举的起点信息
    //            limit     每次返回的最大列举文件数量
    //            delimiter 指定目录分隔符
    let opt = {prefix: ''};
    marker && (opt.marker = marker);
    return new Promise((resolve, reject) => {
        bucketManager.listPrefix(bucket, opt, function (err, respBody, respInfo) {
            if (err) {
                reject(err)
            }

            if (respInfo.statusCode == 200) {
                //如果这个nextMarker不为空，那么还有未列举完毕的文件列表，下次调用listPrefix的时候，
                //指定options里面的marker为这个值
                let nextMarker = respBody.marker;
                let items = respBody.items.map(item => qiniu.rs.deleteOp(bucket, item.key));
                if (nextMarker) {
                    return getListPromise(bucket, nextMarker, preItems.concat(items))
                } else {
                    resolve(preItems.concat(items))
                }
                // deleteOperations.push(qiniu.rs.deleteOp(bucket, item.key))

            } else {
                reject(respBody)
            }
        });

    })
}

getDeleteListPromise(bucket, null, []).then((data) => {
    let needDeleteArr = _array.chunk(data, 1000);
    if(data.length === 0){
        console.log('没有文件需要删除')
    }else{
        console.log('开始删除 %s 块共 %s 个文件', needDeleteArr.length, data.length)
        needDeleteArr.forEach((item, index) => {
            let allFileIsSuccess = true;
            bucketManager.batch(item, function (err, respBody, respInfo) {
                if (err) {
                    console.error(err);
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
                            console.log('第 %s 块共 %s 个文件删除成功', index+1, item.length)
                        } else {
                            console.error('第 %s 块有文件删除失败', index + 1)
                        }
                    } else {
                        console.log(respInfo.deleteusCode);
                        console.log(respBody);
                    }
                }
            });
        })
    }
}).catch(err => console.error(err))