---
name: orders-db
engine: mysql
version: '8.4'
hosting: managed
account: stevie-aws
status: available
spec:
  region: af-south-1
  tier: standard
  storageGb: 50
  autoGrow: true
  ha: false
  allowVms: [api-01]
  backupAt: '02:00'
  keepDays: 7
  adminUser: admin
  database: orders
ref:
  instance: db-seedorders
observed:
  status: available
  storageUsedGb: 18
  host: 10.20.0.8
  seenAt: '{{ago:3m}}'
createdAt: '{{ago:24d}}'
createdBy: { id: stevie, name: Stevie }
---
