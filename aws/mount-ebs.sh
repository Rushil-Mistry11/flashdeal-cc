#!/usr/bin/env bash
# Formats (first time only) and mounts the extra EBS data volume at /mnt/mongo-data, for MongoDB.
#   lsblk                       # find the new disk, usually nvme1n1 (the root disk is nvme0n1)
#   sudo bash aws/mount-ebs.sh /dev/nvme1n1
set -euo pipefail

DEV="${1:-/dev/nvme1n1}"
MOUNT=/mnt/mongo-data

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo"; exit 1; fi
if [ ! -b "$DEV" ]; then echo "Device $DEV not found. Disks:"; lsblk; exit 1; fi
ROOT_SRC=$(findmnt -n -o SOURCE /)
case "$ROOT_SRC" in "$DEV"*) echo "Refusing: $DEV is the root disk"; exit 1 ;; esac

if findmnt -n "$MOUNT" >/dev/null 2>&1; then
  echo "$MOUNT is already mounted"; df -h "$MOUNT"; exit 0
fi

if ! blkid "$DEV" >/dev/null 2>&1; then
  echo "New empty volume: formatting $DEV as ext4"
  mkfs.ext4 -L flashdeal-mongo "$DEV"
else
  echo "$DEV already has a filesystem: keeping its data"
fi

mkdir -p "$MOUNT"
UUID=$(blkid -s UUID -o value "$DEV")
grep -q "$UUID" /etc/fstab || echo "UUID=$UUID $MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab   # remount automatically after a reboot
mount "$MOUNT"

# MongoDB's data goes in a sub-folder (a fresh ext4 root contains lost+found). The mongo image runs as uid 999.
mkdir -p "$MOUNT/db"
chown -R 999:999 "$MOUNT/db"
echo "Mounted:"; df -h "$MOUNT"
