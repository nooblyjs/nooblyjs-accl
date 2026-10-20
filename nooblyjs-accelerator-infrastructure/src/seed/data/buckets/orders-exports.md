---
name: orders-exports
account: stevie-aws
status: ready
spec:
  region: af-south-1
  storageClass: standard
  access: private
  versioning: false
links:
  - { app: orders-api, mode: read-write }
ref:
  bucket: orders-exports
observed:
  status: ready
  bytes: 41000000000
  objects: 2190
  seenAt: '{{ago:40m}}'
createdAt: '{{ago:24d}}'
createdBy: { id: stevie, name: Stevie }
---
