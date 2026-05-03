# Temu Droplet Plugin (Minimal Skeleton)

This is a minimal Python droplet plugin skeleton with three key parts:

- **Plugin entry**: `executor.py`
- **Module dispatch**: `modules/`  
  (`sales`, `activity`, `settlement`, `managed_compensation`)
- **Unified upload template**: `utils/uploader.py`

## Run locally

```bash
cd temu-droplet-plugin

# install dependencies (if needed)
pip install -r requirements.txt

# run a single module
python executor.py --module sales --external-spec-id SPEC-001

# run multiple modules
python executor.py --module sales,activity --payload-file payload.example.json --out-dir output
```

### Parameters

- `--module` (required): module name list separated by comma.
  Supported: `sales,activity,settlement,managed_compensation`
- `--external-spec-id`: external supplier ID (for example 1688-like specId).
- `--payload`: JSON string inline.
- `--payload-file`: JSON payload file.
- `--payload` and `--payload-file` are merged, where inline `--payload` has higher priority.
- `--out-dir`: output directory (default: `output`).
- `--run-id`: optional run id, auto-generated when empty.

## Artifact format

Each module generates one JSON file and the unified result includes:

`businessType / rpaType / data / meta / hints / payload / run_id / generatedAt`

Example file: `output/sales_xxx.json`

## unified upload template

`utils/uploader.py` uses one method `upload_with_template(...)`:

1. Try cloud upload first (if `DROPLET_UPLOAD_URL` and `DROPLET_UPLOAD_TOKEN` are configured).
2. On failure or missing config, fallback to local directory.

Supported environment variables:

- `DROPLET_UPLOAD_URL`
- `DROPLET_UPLOAD_TOKEN`
- `DROPLET_UPLOAD_TIMEOUT` (default `20`)
- `DROPLET_FALLBACK_DIR` (default `output/uploaded`)
- `DROPLET_PROJECT` (default `temu-automation`)

Return payload has:

- `ok`: bool
- `mode`: `cloud` or `local`

## external_spec_id

`external_spec_id` is the identifier from the upstream supplier/business domain (not an internal product key).  
Use it to bind the collected rows to the source supplier/market spec during downstream ingestion.

## Minimal deploy/restart on host (cloud control)

```bash
# upload plugin package
tar -czf temu-droplet-plugin.tgz -C temu-droplet-plugin .
scp temu-droplet-plugin.tgz user@<host>:/tmp/

# on host
ssh user@<host>
mkdir -p /opt/temu-droplet-plugin
tar -xzf /tmp/temu-droplet-plugin.tgz -C /opt/temu-droplet-plugin
cd /opt/temu-droplet-plugin
pip install -r requirements.txt

# restart plugin worker / service
pkill -f "executor.py" || true
nohup python /opt/temu-droplet-plugin/executor.py --module sales,activity,settlement,managed_compensation \
  --payload-file /opt/temu-droplet-plugin/payload.json \
  > /var/log/temu-droplet-plugin.log 2>&1 &
```

## Notes

- This is a minimum viable skeleton.
- The four modules are stubs and can be replaced with real API clients and DB adapters.
