---
id: op_seedlaunch
type: vm.launch
resource: { type: vm, name: docs-01 }
account: stevie-prod
label: Launch docs-01
status: running
progress: 10
steps:
  - { key: create, label: Create the machine, status: running }
  - { key: prepare, label: Prepare it, status: pending }
  - { key: endpoint, label: Endpoint, status: pending }
state: {}
input: {}
requestedBy: { id: stevie, name: Stevie }
createdAt: '{{ago:4m}}'
startedAt: '{{ago:4m}}'
---

{{ago:4m}}  Queued: Launch docs-01 (by Stevie)
{{ago:4m}}  Started
