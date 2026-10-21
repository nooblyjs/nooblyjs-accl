---
name: web-01
role: app
account: stevie-prod
status: running
spec:
  region: africa-south1
  zone: africa-south1-a
  machineType: e2-medium
  image: ubuntu-2404-lts
  diskGb: 30
  docker: true
  sshKeyId: key_seedmacbook
  sshFrom: my-ip
ref:
  network: net-seedgcp1
  instance: vm-seedweb01
  address: ip-seedweb01
observed:
  status: running
  publicIp: 203.0.113.24
  privateIp: 10.10.0.12
  machineType: e2-medium
  seenAt: '{{ago:3m}}'
startedAt: '{{ago:18d}}'
runtime:
  docker: 27.3.1
createdAt: '{{ago:18d}}'
createdBy: { id: stevie, name: Stevie }
---
