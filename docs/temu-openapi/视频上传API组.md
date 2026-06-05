# 视频上传API组

> 来源 Temu 开放平台文档中心 ｜ 抓取 2026-06-04 ｜ 3 个接口


---

## bg.goods.video.upload.sign.get.global

bg.goods.video.upload.sign.get.global
查询视频上传sign接口-global
更新时间：2025-06-23 13:55:33
接口介绍：视频文件上传sign查询
公共参数
收起
请求地址
调用地址/地区	数据存储
/openapi/router	CN
公共请求参数
参数接口	参数类型	是否必填	说明
type	STRING	是	API接口名, 形如:bg.*
app_key	STRING	是	已创建成功的应用标志
timestamp	STRING	是	时间戳，格式为UNIX时间（秒） ，长度10位，当前时间-300秒<=入参时间<=当前时间+300秒
sign	STRING	是	API入参参数签名，签名值根据如下算法给出计算过程
data_type	STRING	否	请求返回的数据格式，可选参数固定为JSON
access_token	STRING	是	用户授权令牌access_token，卖家中心—授权管理，申请授权生成
version	STRING	是	API版本，默认为V1，无要求不传此参数
请求参数说明
收起
参数接口	参数类型	是否必填	说明
暂无数据
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
sign	STRING	The use of this file uploadsign
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
120000000	系统异常，请稍后再试	一般为系统抖动，请稍后重试
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
商品视频上传权限包	He uses type、Self use type
货品API组	He uses type、Self use type


---

## bg.goods.big.video.upload.result.get.global

bg.goods.big.video.upload.result.get.global
查询视频转码结果接口-global
更新时间：2025-06-23 13:55:28
接口介绍：查询视频转码结果接口
公共参数
收起
请求地址
调用地址/地区	数据存储
/openapi/router	CN
公共请求参数
参数接口	参数类型	是否必填	说明
type	STRING	是	API接口名, 形如:bg.*
app_key	STRING	是	已创建成功的应用标志
timestamp	STRING	是	时间戳，格式为UNIX时间（秒） ，长度10位，当前时间-300秒<=入参时间<=当前时间+300秒
sign	STRING	是	API入参参数签名，签名值根据如下算法给出计算过程
data_type	STRING	否	请求返回的数据格式，可选参数固定为JSON
access_token	STRING	是	用户授权令牌access_token，卖家中心—授权管理，申请授权生成
version	STRING	是	API版本，默认为V1，无要求不传此参数
请求参数说明
收起
参数接口	参数类型	是否必填	说明
vid	STRING	否	-
返回参数说明
收起
参数接口	参数类型	说明
result	OBJECT	result
vid	STRING	Corresponding to the videovid
coverUrl	STRING	Cover image corresponding to the videourl
videoUrl	STRING	Access corresponding to the videourl
width	INTEGER	Video width
height	INTEGER	Video height
success	BOOLEAN	status
errorCode	INTEGER	error code
errorMsg	STRING	error message
返回错误码说明
收起
错误码	错误描述	解决办法
120000001	请求入参非法	请检查请求入参后重试
120000000	系统异常，请稍后再试	一般为系统抖动，请稍后重试
120000011	视频初始化状态未知，请稍后再试	视频初始化状态未知，请稍后再试
120000012	视频未初始完成，请稍后再试	视频未初始完成，请稍后再试
120000013	视频初始化失败，请重试	视频初始化失败，请重新上传
120000014	视频大小应在100MB以内	视频过大，请调整后重新上传
120000016	视频比例需为1:1或3:4或16:9，建议使用比例1:1或3:4	视频比例不支持，请调整后重新上传
权限包
收起
拥有此接口的权限包	可获得/可申请此权限包的应用类型
商品视频上传权限包	He uses type、Self use type
货品API组	He uses type、Self use type


---

## 视频上传流程

视频上传流程
更新时间：2025-08-04 14:19:33
接口调用流程




1、文件上传：



对于20MB以下的视频


通过接口1获取视频上传的Sign
调用文件上传接口2上传文件，获取视频对应vid


对于20MB以上的大视频


通过接口1获取视频上传的Sign
调用大视频文件上传初始化接口3获取分片文件上传Sign
通过接口4分片上传文件
调用接口5完成分片上传，获取视频对应vid



2、获取视频转码结果：



通过文件上传返回的vid查询发品所用的视频链接、视频尺寸等信息，视频处理需要时间，上传完成后延迟获取







关于视频质量说明



上传优质主图视频，商品可获得免费流量扶持，预估销量提升2%-30%+

1、使用宽高比1:1或3:4或16:9视频（建议优先采用1:1或3:4视频），大小500M内。最多不超过60s

2、上传视频内容需含商品主图，非PPT、无黑边、无水印，且内容及背景音乐需确认无IP侵权

3、上传视频内容建议前10s内突出商品的核心卖点，最好能有语音讲解或配英文字幕 

4、画质清晰，整体不可过暗，不能有较大黑边; 2、播放流畅，画面不可抖动;

5、不可加入外域网址及私人联系方式;图片中避免出现其他品牌及水印;

6、主图视频格式：










1、查询视频上传sign接口




bg.goods.video.upload.sign.get

bg.goods.video.upload.sign.get.global







2、20MB以下视频上传




接口信息 

	

内容 




接口编号

	

2




是否需要授权 

	

否，只需传入1中获取的sign即可




调用地址

	

https://openapi.kuajingmaihuo.com/api/galerie/v1/store_video

https://openapi-b-partner.temu.com/api/galerie/v1/store_video

请求参数：



参数名称

	

类型

	

是否必须

	

说明




file

	

File

	

是

	

视频文件




create_media

	

Boolean

	

是

	

固定值，true




content_md5

	

String

	

否

	

文件MD5值，用于校验实际收到的数据和发起方本地的数据是否一致




sign

	

String

	

是

	

1中获取的文件上传Sig

返回参数： 



参数名称

	

类型

	

是否必须

	

说明




vid

	

String

	

是

	

上传视频文件对应vid，后续查询转码结果使用




error_code

	

int

	




	

成功时不返回




error_msg

	

String

	




	

错误消息






3、20MB以上视频上传初始化

接口信息 

	

内容 




接口编号

	

3




是否需要授权 

	

否，只需传入1中获取的sign即可




调用地址

	

https://openapi.kuajingmaihuo.com/api/galerie/large_file/v1/video/upload_init

https://openapi-b-partner.temu.com/api/galerie/large_file/v1/video/upload_init

请求参数：



参数名称



	

类型



	

是否必须



	

说明






create_media

	

Boolean

	

是

	

固定值，true




content_type

	

String

	

是

	

文件对应的contentType,且必须为视频类型，eg：video/quicktime、video/mp4等




sign

	

String

	

是

	

1中获取的文件上传Sign

返回参数： 



参数名称

	

类型

	

是否必须

	

说明




sign

	

String

	

是

	

标记本次大文件上传的id



4、20MB以上视频分片上传




接口信息 

	

内容 




接口编号

	

4




是否需要授权 

	

否，只需传入3中获取的sign即可




调用地址

	

https://openapi.kuajingmaihuo.com/api/galerie/large_file/v1/video/upload_part

https://openapi-b-partner.temu.com/api/galerie/large_file/v1/video/upload_part

请求参数：



参数名称

	

类型

	

是否必须

	

说明




part_file

	

File

	

是

	

视频分片文件




content_md5

	

String

	

否

	

文件MD5值，用于校验实际收到的数据和发起方本地的数据是否一致




sign

	

String

	

是

	

3中获取的文件上传Sign




part_num

	

String

	

是

	

当前分片编号名，从1开始

返回参数： 



参数名称

	

类型

	

是否必须

	

说明




uploaded_part_num

	

int

	

是



	

表示本次成功上传的part number




error_code

	

int

	




	

成功时不返回




error_msg

	

String

	




	

错误消息

5、20MB以上视频分片上传完成接口



接口信息 

	

内容 




接口编号

	

5




是否需要授权 

	

否，只需传入3中获取的sign即可




调用地址

	

https://openapi.kuajingmaihuo.com/api/galerie/large_file/v1/video/upload_complete

https://openapi-b-partner.temu.com/api/galerie/large_file/v1/video/upload_complete

请求参数：



参数名称

	

类型

	

是否必须

	

说明




content_md5

	

String

	

否

	

当前大文件的md5，用于违规资源拦截检测




sign

	

String

	

是

	

3中获取的文件上传Sign

返回参数： 



参数名称

	

类型

	

是否必须

	

说明




vid

	

String

	

是

	

上传视频文件对应vid，后续查询转码结果使用

6、查询视频转码结果接口




bg.goods.big.video.upload.result.get

bg.goods.big.video.upload.result.get.global

接口调用流程
关于视频质量说明
1、查询视频上传sign接口
2、20MB以下视频上传
3、20MB以上视频上传初始化
4、20MB以上视频分片上传
5、20MB以上视频分片上传完成接口
6、查询视频转码结果接口
