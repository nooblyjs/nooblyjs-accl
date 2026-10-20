---
name: analytics
engine: mysql
version: '8.0'
hosting: managed
account: stevie-prod
status: backing-up
spec:
  region: africa-south1
  tier: performance
  storageGb: 200
  autoGrow: true
  ha: false
  allowVms: [worker-01]
  backupAt: '02:00'
  keepDays: 14
  adminUser: admin
  database: analytics
ref:
  instance: db-seedanalytics
observed:
  status: available
  storageUsedGb: 126
  host: 10.10.0.9
  seenAt: '{{ago:3m}}'
createdAt: '{{ago:20d}}'
createdBy: { id: stevie, name: Stevie }
---
