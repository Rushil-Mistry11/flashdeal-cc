# Project requirements and where each one is covered

| Requirement | Where it is covered |
|---|---|
| **Cloud generation / cloud model** (what kind of cloud, which service and deployment models) | Public cloud (AWS Learner Lab, us-east-1). **IaaS**: EC2, EBS, VPC / Security Group, Elastic IP (we manage the OS, Docker, the app). **Managed / PaaS-style services**: SQS, CloudWatch, SNS, S3, IAM (AWS runs them). The finished application is delivered to users as **SaaS** over the web. Diagrams: `docs/architecture.md`; how each AWS service is created: `docs/aws-deploy.md` |
| **Cloud service usage** | The 8 services and their role: table in `README.md`; implementation steps and the four demo tests: `docs/aws-deploy.md`; what changed from the local version and why: `docs/changes-from-sd.md` |
| **Costing** | `docs/cost-analysis.md`: unit prices, three scenarios (course project about $7.50 a month, always-on about $21.50, growth about $98), cost-saving measures |
| **CI/CD pipeline design** | `docs/cicd-design.md` (design, stages, gates, rollback, secrets, setup) and the working pipeline `.github/workflows/ci-cd.yml` with the post-deployment check `scripts/smoke-test.sh` |
| **Cloud security concerns** | `docs/security.md`: shared responsibility, 17 threats with controls and residual risks, demo checklist |
| **SLA documentation** | `docs/sla.md`: AWS upstream SLAs, availability calculation, FlashDeal SLOs, RPO / RTO, support, exclusions, credits |
| **Web application hosted online, attached to the cloud** | The React shop and API run on EC2 behind an Elastic IP (`http://<Elastic IP>`), use SQS for the queue, EBS for the database, CloudWatch for logs. Start the lab and the instance before the evaluation; keep the instance running during it |
