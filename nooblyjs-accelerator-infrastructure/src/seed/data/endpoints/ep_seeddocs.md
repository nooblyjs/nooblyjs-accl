---
id: ep_seeddocs
vm: docs-01
app: docs
address: domain
host: docs.example.com
path: /
port: 8080
redirectHttp: true
cert:
  source: letsencrypt
  status: pending
dns:
  status: verified
  checkedAt: '{{ago:2m}}'
createdAt: '{{ago:4m}}'
---
