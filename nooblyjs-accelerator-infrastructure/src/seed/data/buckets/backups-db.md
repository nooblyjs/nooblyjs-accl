---
name: backups-db
account: stevie-aws
status: ready
spec:
  region: af-south-1
  storageClass: standard
  access: private
  versioning: true
  keepVersionsDays: 30
ref:
  bucket: backups-db
observed:
  status: ready
  bytes: 16000000000
  objects: 96
  seenAt: '{{ago:40m}}'
createdAt: '{{ago:24d}}'
createdBy: { id: stevie, name: Stevie }
---
