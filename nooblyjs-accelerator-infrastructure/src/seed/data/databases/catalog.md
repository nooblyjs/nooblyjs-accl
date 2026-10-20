---
name: catalog
engine: mongodb
version: '7.0'
hosting: vm
vm: catalog-db
account: stevie-prod
status: available
spec:
  region: africa-south1
  tier: standard
  storageGb: 20
  autoGrow: true
  ha: false
  allowVms: [web-01]
  backupAt: '02:00'
  keepDays: 7
  adminUser: admin
  database: catalog
observed:
  status: available
  storageUsedGb: 7
  host: 10.10.0.30
  seenAt: '{{ago:3m}}'
createdAt: '{{ago:15d}}'
createdBy: { id: stevie, name: Stevie }
---
