---
id: ep_seedapi
vm: api-01
app: orders-api
address: domain
host: api.example.com
path: /
port: 3000
redirectHttp: true
cert:
  source: letsencrypt
  status: valid
  expiresAt: '{{in:61d}}'
dns:
  status: verified
  checkedAt: '{{ago:2m}}'
createdAt: '{{ago:18d}}'
---
