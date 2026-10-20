---
name: storefront
vm: web-01
status: live
source:
  repo: https://github.com/stevie/storefront.git
  branch: main
  dockerfile: ./Dockerfile
  context: .
  gitConnection: github-stevie
run:
  port: 3000
  restart: always
  env:
    - { key: NODE_ENV, value: production }
    - { key: DATABASE_URL, link: { database: catalog } }
    - { key: MEDIA_BUCKET, link: { bucket: stevie-media } }
healthCheck: /healthz
autoDeploy: true
current:
  commit: a1f3c9e
  deployedAt: '{{ago:12m}}'
  trigger: push
createdAt: '{{ago:20d}}'
createdBy: { id: stevie, name: Stevie }
---
