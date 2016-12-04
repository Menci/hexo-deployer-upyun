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
