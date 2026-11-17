#!/usr/bin/env bash
# Run ONCE on a fresh Ubuntu 22.04/24.04 EC2 instance (x86_64):   bash aws/ec2-bootstrap.sh
# Installs Docker Engine + Compose plugin, AWS CLI v2, jq.
set -euo pipefail

sudo apt-get update -y
sudo apt-get install -y ca-certificates curl unzip jq

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q -o /tmp/awscliv2.zip -d /tmp
  sudo /tmp/aws/install
fi

echo
docker --version
docker compose version
aws --version
echo
echo "Done. Log out and SSH back in once so the 'docker' group takes effect."
