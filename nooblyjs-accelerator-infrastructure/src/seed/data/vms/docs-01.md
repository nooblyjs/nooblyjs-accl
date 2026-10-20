---
name: docs-01
role: app
account: stevie-prod
status: starting
spec:
  region: africa-south1
  zone: africa-south1-a
  machineType: e2-small
  image: ubuntu-2404-lts
  diskGb: 30
  docker: true
  sshKeyId: key_seedmacbook
  sshFrom: my-ip
ref:
  instance: vm-seeddoc01
  address: null
createdAt: '{{ago:4m}}'
createdBy: { id: stevie, name: Stevie }
---
