---
id: ep_seedblog
vm: web-01
app: blog
address: domain
host: blog.example.com
path: /
port: 8080
redirectHttp: true
cert:
  source: letsencrypt
  status: valid
  expiresAt: '{{in:74d}}'
dns:
  status: verified
  checkedAt: '{{ago:2m}}'
createdAt: '{{ago:18d}}'
---
