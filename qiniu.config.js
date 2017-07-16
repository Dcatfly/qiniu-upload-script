const qiniuConfig = {
	accessKey: 'your ak',
	secretKey: 'your sk',
	originPath: 'disk',
	originFile: 'index.html',
	oldOriginPath: 'oldDisk',
	zone: '七牛云空间的所属zone',
	envConfig: {
		testing: {
			bucket: 'your bucket',
			cdnHost: '你cdn的域名'
		},
		prod: {
			bucket: '',
			cdnHost: ''
		}
	}
}

module.exports =  qiniuConfig;
