---
name: orders-api
vm: api-01
status: live
source:
  repo: https://github.com/stevie/orders-api.git
  branch: main
  dockerfile: ./Dockerfile
  context: .
  gitConnection: github-stevie
run:
  port: 3000
  restart: always
  env:
    - { key: DATABASE_URL, link: { database: orders-db } }
    - { key: EXPORTS_BUCKET, link: { bucket: orders-exports } }
healthCheck: /healthz
autoDeploy: true
current:
  commit: e81d4a2
  deployedAt: '{{ago:1d}}'
  trigger: push
createdAt: '{{ago:20d}}'
createdBy: { id: stevie, name: Stevie }
---
