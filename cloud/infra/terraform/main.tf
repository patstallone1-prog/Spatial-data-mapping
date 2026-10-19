# Kerbside cloud: the always-on controller and the two R2 buckets.
#
# Workers are not here: the controller starts and deletes them through the providers' APIs
# (src/smc/cloud/providers.py), labelled kerbside=worker so nothing it did not start is touched.
#
#   cd cloud/infra/terraform
#   terraform init
#   terraform apply -var-file=kerbside.tfvars        # see kerbside.tfvars.example
#
# Secrets (API tokens) are variables, never committed; the controller's own secrets are copied
# to the server after boot by cloud/deploy/push-secrets.sh, so they are not in its user data.

terraform {
  required_version = ">= 1.6"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

resource "hcloud_ssh_key" "operator" {
  name       = "kerbside-operator"
  public_key = var.ssh_public_key
}

# The controller answers HTTPS (workers, dashboard) and SSH from the operator's address only.
resource "hcloud_firewall" "controller" {
  name = "kerbside-controller"
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.operator_cidrs
  }
}

# Workers accept nothing inbound: they call out to the controller and R2.
resource "hcloud_firewall" "workers" {
  name = "kerbside-workers"
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = var.operator_cidrs
  }
}

resource "hcloud_server" "controller" {
  name         = "kerbside-controller"
  server_type  = var.controller_type
  image        = "docker-ce"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.operator.id]
  firewall_ids = [hcloud_firewall.controller.id]
  backups      = var.controller_backups
  labels = {
    kerbside = "controller"
  }
  user_data = templatefile("${path.module}/../cloud-init/controller.yaml.tftpl", {
    domain = var.controller_domain
    image  = var.image_cpu
  })
  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }
}

resource "cloudflare_r2_bucket" "private" {
  account_id = var.cloudflare_account_id
  name       = var.private_bucket
  location   = "WNAM"
}

resource "cloudflare_r2_bucket" "public" {
  account_id = var.cloudflare_account_id
  name       = var.public_bucket
  location   = "WNAM"
}

output "controller_ipv4" {
  value = hcloud_server.controller.ipv4_address
}

output "workers_firewall_id" {
  description = "Put in cloud/config/kerbside-cloud.toml [hetzner] firewall_ids."
  value       = hcloud_firewall.workers.id
}

output "next_steps" {
  value = <<-EOT
    1. DNS: ${var.controller_domain} A ${hcloud_server.controller.ipv4_address}
    2. R2: connect ${var.public_domain} to ${var.public_bucket}; set CORS from cloud/infra/r2-cors.json
    3. R2: create two API tokens (Object Read & Write), one scoped to each bucket
    4. cloud/deploy/push-secrets.sh ${hcloud_server.controller.ipv4_address}
  EOT
}
