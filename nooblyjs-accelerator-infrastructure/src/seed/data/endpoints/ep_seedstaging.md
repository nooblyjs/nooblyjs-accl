---
id: ep_seedstaging
vm: staging-01
app: admin
address: domain
host: staging.example.com
path: /
port: 3000
redirectHttp: true
cert:
  source: letsencrypt
  status: valid
  expiresAt: '{{in:40d}}'
dns:
  status: verified
  checkedAt: '{{ago:2m}}'
createdAt: '{{ago:18d}}'
---
