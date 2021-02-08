**For newer versions of Hexo, please use [hexo-deployer-upyun2019](https://github.com/abcdGJJ/hexo-deployer-upyun2019).**  
**对于较新版本的 Hexo，请使用 [hexo-deployer-upyun2019](https://github.com/abcdGJJ/hexo-deployer-upyun2019)。**

# hexo-deployer-upyun
UPYUN deployer for Hexo.

```
npm install hexo-deployer-upyun --save
```

# Usage
Example configure:

```yaml
deploy:
  type: upyun
  bucket: bucket
  operator: operator
  password: password
  endpoint: v0.api.upyun.com
  secret: secret
  try_times: 5
  ignore_path_re:
    dir: null
    file: ".DS_Store$"
```
