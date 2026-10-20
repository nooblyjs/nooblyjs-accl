---
id: op_seedbackup
type: db.backup
resource: { type: database, name: analytics }
account: stevie-prod
label: Back up analytics
status: running
progress: 64
steps:
  - { key: start, label: Start backup, status: done }
  - { key: wait, label: Wait for the backup, status: running }
state: {}
input: {}
requestedBy: { id: stevie, name: Stevie }
createdAt: '{{ago:20m}}'
startedAt: '{{ago:20m}}'
---

{{ago:20m}}  Queued: Back up analytics (by Stevie)
{{ago:20m}}  Started
