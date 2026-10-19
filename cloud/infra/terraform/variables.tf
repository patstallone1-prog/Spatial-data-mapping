variable "hcloud_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_api_token" {
  description = "A token with R2 edit on the account (only to create the buckets)."
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  type = string
}

variable "ssh_public_key" {
  type = string
}

variable "operator_cidrs" {
  description = "Addresses allowed to SSH to the controller."
  type        = list(string)
}

variable "controller_domain" {
  description = "The controller's HTTPS name, e.g. control.example.org (Caddy gets its certificate)."
  type        = string
}

variable "public_domain" {
  description = "The public bucket's custom domain, e.g. assets.example.org."
  type        = string
}

variable "controller_type" {
  description = "Two shared vCPUs are plenty: the controller schedules, gates and publishes."
  type        = string
  default     = "cx23"
}

variable "controller_backups" {
  description = "Hetzner's daily server backups (+20 %); the queue is also backed up to R2."
  type        = bool
  default     = false
}

variable "location" {
  description = "Falkenstein: the cost-optimised CX line is sold only in Germany and Finland, and the controller's work does not depend on where it is."
  type        = string
  default     = "fsn1"
}

variable "image_cpu" {
  type    = string
  default = "ghcr.io/patstallone1-prog/kerbside-cpu:main"
}

variable "private_bucket" {
  type    = string
  default = "kerbside-private"
}

variable "public_bucket" {
  type    = string
  default = "kerbside-public"
}
