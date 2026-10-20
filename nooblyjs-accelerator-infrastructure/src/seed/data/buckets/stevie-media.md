---
name: stevie-media
account: stevie-prod
status: ready
spec:
  region: africa-south1
  storageClass: standard
  access: public
  versioning: false
  domain: media.example.com
  lifecycle:
    - { prefix: tmp/, deleteAfterDays: 7 }
links:
  - { app: storefront, mode: read-write }
ref:
  bucket: stevie-media
observed:
  status: ready
  bytes: 124000000000
  objects: 18402
  seenAt: '{{ago:40m}}'
createdAt: '{{ago:28d}}'
createdBy: { id: stevie, name: Stevie }
---
