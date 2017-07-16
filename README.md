# qiniu-upload-script
一个将指定文件夹内容上传到七牛空间的脚本。
适用于前端工程webpack构建完成后自动上传到七牛。
## 特点
- 支持传入不同环境参数调用不同环境配置
- 支持自动文件比对，只上传不同的文件并删除此次版本不存在的老版本的文件
- 支持错误重传
- 支持上传成功后自动刷新cdn
- 支持一条命令清除七牛存储空间中的老旧文件。


## 配置
`qiniu.config.js`是七牛的配置文件。该文件中有各项配置的详细说明。

```js
const qiniuConfig = {
	accessKey: '七牛提供的ak',
	secretKey: '七牛提供的sk',
	originPath: '你想上传的文件夹，一般也是存储编译结果的文件夹，比如 disk',
	originFile: '编译完成后的引导，比如index.html，指定此文件会自动将文件中的"/styles/images/a.png"替换为"${cdnHost}/styles/images/a.png"',
	oldOriginPath: '上一次编译结果的保存文件夹，这个需要在npm run dev之类的编译命令中完成，也为了能快速的回退版本。如 oldDisk',
	zone: '七牛云空间的所属zone',
	envConfig: {
		//因为前端工程可能有多个不同环境下的，比如测试环境下、生产环境下的，只需在这里分别配置不同环境下的bucket和cdn的域名就可以了
		// 使用node运行脚本时会根据提供的参数识别相应的配置。
		testing: {
			bucket: 'your bucket',
			cdnHost: '你cdn的域名 如http://cdn.com'
		},
		prod: {
			bucket: '',
			cdnHost: ''
		}
	}
}
```

## 使用
将`upload-qiniu.js`和`qiniu.config.js`和`clear-qiniu.js`三个文件拷贝到前端工程根目录下，改写`qiniu.config.js`中的对应配置，并安装`package.json`中的`dependencies`下的依赖，然后可通过

```
node upload-qiniu <env>
```

执行上传操作。 

同时此脚本默认隐藏debug信息，若想知道更详细错误信息请运行

```
node upload-qiniu <env> debug
```
若想删除七牛云空间中的已存储文件，请运行

```
node clear-qiniu <env>
```
## 建议
建议将以上命令结合`npm run `来使用，比如：

```
export APP_ENV=testing && export FOLDER_TMP=oldDest && rm -rf oldDest && mkdir oldPro  && webpack --config webpack.testing.config.js && mv dist distTmp && mv oldPro dist && mv distTmp oldPro && node upload-qiniu testing
```
