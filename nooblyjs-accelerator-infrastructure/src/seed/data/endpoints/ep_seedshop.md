---
id: ep_seedshop
vm: web-01
app: storefront
address: domain
host: shop.example.com
path: /
port: 3000
redirectHttp: true
cert:
  source: letsencrypt
  status: valid
  expiresAt: '{{in:55d}}'
dns:
  status: verified
  checkedAt: '{{ago:2m}}'
createdAt: '{{ago:18d}}'
---
