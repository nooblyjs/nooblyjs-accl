---
name: catalog-db
role: database
ownedBy: catalog
account: stevie-prod
status: running
spec:
  region: africa-south1
  zone: africa-south1-a
  machineType: e2-medium
  image: ubuntu-2204-lts
  diskGb: 10
  dataDiskGb: 20
  docker: false
ref:
  network: net-seedgcp1
  instance: vm-seedcat01
observed:
  status: running
  publicIp: null
  privateIp: 10.10.0.30
  machineType: e2-medium
  seenAt: '{{ago:3m}}'
startedAt: '{{ago:15d}}'
createdAt: '{{ago:15d}}'
createdBy: { id: stevie, name: Stevie }
---
