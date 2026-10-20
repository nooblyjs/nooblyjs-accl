---
name: api-01
role: app
account: stevie-aws
status: running
spec:
  region: af-south-1
  zone: af-south-1a
  machineType: t3.medium
  image: ubuntu-2404-lts
  diskGb: 30
  docker: true
  sshKeyId: key_seedmacbook
  sshFrom: my-ip
ref:
  instance: vm-seedapi01
  address: ip-seedapi01
observed:
  status: running
  publicIp: 198.51.100.31
  privateIp: 10.20.0.15
  machineType: t3.medium
  seenAt: '{{ago:3m}}'
createdAt: '{{ago:25d}}'
createdBy: { id: stevie, name: Stevie }
---
