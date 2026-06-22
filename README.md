# FastAPI Nginx Manager Guide

This project is a one-night FastAPI backend for managing simple Nginx reverse proxy sites through an external UI.

The first iteration should do one thing well: accept reverse proxy site details, generate an Nginx config from a template, save it locally, install it into Nginx, validate it, reload only when valid, and expose useful diagnostic output back to the UI.

## First Iteration Goals

1. Add a new reverse proxy site.
2. Generate Nginx config from a template.
3. Save config to a local project folder first.
4. Copy config to `/etc/nginx/sites-available/`.
5. Enable site using a symlink.
6. Run `nginx -t`.
7. Reload Nginx only if the test passes.
8. Disable site by removing the symlink.
9. Show `nginx -t` output in the UI.
10. Show the last 100 lines of `error.log`.

## Target Mental Model

Ubuntu and Debian commonly use this layout:

```text
/etc/nginx/
  nginx.conf
  sites-available/
    example.local
  sites-enabled/
    example.local -> ../sites-available/example.local
/var/log/nginx/
  access.log
  error.log
```

Your app should be designed around this shape, because the target machine is likely an Ubuntu server.

On macOS with Nginx installed through Homebrew, the real paths are usually different. The common Apple Silicon layout is:

```text
/opt/homebrew/etc/nginx/
/opt/homebrew/var/log/nginx/
```

The common Intel Mac layout is:

```text
/usr/local/etc/nginx/
/usr/local/var/log/nginx/
```

For local development, create Ubuntu-like folders inside the Brew Nginx config directory:

```text
/opt/homebrew/etc/nginx/sites-available/
/opt/homebrew/etc/nginx/sites-enabled/
```

or, on Intel Macs:

```text
/usr/local/etc/nginx/sites-available/
/usr/local/etc/nginx/sites-enabled/
```

Then make the main `nginx.conf` include enabled sites:

```nginx
http {
    include       mime.types;
    default_type  application/octet-stream;

    include sites-enabled/*;
}
```

This lets your app behave almost the same locally and on Ubuntu.

## Recommended Project Structure

Start small, but keep the boundaries clear:

```text
ngnix-manager/
  app/
    main.py
    config.py
    models.py
    nginx_service.py
    template_service.py
    command_runner.py
    templates/
      reverse_proxy.conf.j2
  generated-sites/
    .gitkeep
  README.md
  requirements.txt
  .env.example
```

Use `generated-sites/` as the local staging folder. Every generated config should be written there before it is copied into Nginx.

## Environment Configuration

Do not hardcode Nginx paths. Use environment variables so the same app can run on macOS and Linux.

Example `.env` values for macOS Apple Silicon:

```env
NGINX_BIN=/opt/homebrew/bin/nginx
NGINX_PREFIX=/opt/homebrew/etc/nginx
NGINX_SITES_AVAILABLE=/opt/homebrew/etc/nginx/sites-available
NGINX_SITES_ENABLED=/opt/homebrew/etc/nginx/sites-enabled
NGINX_ERROR_LOG=/opt/homebrew/var/log/nginx/error.log
NGINX_RELOAD_CMD=brew services reload nginx
LOCAL_GENERATED_DIR=generated-sites
```

Example `.env` values for Ubuntu:

```env
NGINX_BIN=/usr/sbin/nginx
NGINX_PREFIX=/etc/nginx
NGINX_SITES_AVAILABLE=/etc/nginx/sites-available
NGINX_SITES_ENABLED=/etc/nginx/sites-enabled
NGINX_ERROR_LOG=/var/log/nginx/error.log
NGINX_RELOAD_CMD=systemctl reload nginx
LOCAL_GENERATED_DIR=generated-sites
```

For the first version, you can run the FastAPI app with enough permissions to copy files and reload Nginx. Later, replace that with a safer privileged helper or tightly scoped `sudoers` rules.

## FastAPI Endpoints

Keep the API boring and explicit.

```text
POST /sites
GET  /sites
GET  /sites/{site_name}
POST /sites/{site_name}/enable
POST /sites/{site_name}/disable
POST /nginx/test
POST /nginx/reload
GET  /nginx/error-log?lines=100
```

For the first night, `POST /sites` can create and enable in one flow if you want speed:

```text
POST /sites
  1. Validate request body.
  2. Render template.
  3. Save to generated-sites/{site_name}.conf.
  4. Copy to sites-available/{site_name}.conf.
  5. Create symlink in sites-enabled.
  6. Run nginx -t.
  7. If valid, reload Nginx.
  8. If invalid, remove symlink and return test output.
```

Returning command output is important. The UI should never have to guess what happened.

## Request Model

Use a deliberately small model:

```json
{
  "site_name": "my-app.local",
  "server_name": "my-app.local",
  "upstream_url": "http://127.0.0.1:3000",
  "listen_port": 80
}
```

Validation rules:

- `site_name` should only allow letters, numbers, dots, dashes, and underscores.
- `site_name` should not allow `/`, `..`, spaces, shell characters, or absolute paths.
- `server_name` should be a hostname-style value.
- `upstream_url` should be an `http://` or `https://` URL.
- `listen_port` should usually be `80`, `443`, or a safe local development port.

This is not just neatness. Your app will write files and run system commands, so input validation is part of the security boundary.

## Template

Use Jinja2 for config generation.

`app/templates/reverse_proxy.conf.j2`:

```nginx
server {
    listen {{ listen_port }};
    server_name {{ server_name }};

    access_log {{ access_log_path }};
    error_log {{ error_log_path }};

    location / {
        proxy_pass {{ upstream_url }};
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

For the first version, use Nginx's global logs if you want less setup. Per-site logs are nicer, but not required.

## Core Flow

The most important backend function is `create_site`.

Pseudo-flow:

```text
create_site(payload):
  safe_name = validate_site_name(payload.site_name)
  rendered = render_reverse_proxy_template(payload)

  local_path = generated-sites/{safe_name}.conf
  available_path = sites-available/{safe_name}.conf
  enabled_path = sites-enabled/{safe_name}.conf

  write local_path
  copy local_path to available_path
  create symlink enabled_path -> available_path

  test_result = run nginx -t

  if test_result failed:
      remove enabled_path
      return failure response with stdout/stderr

  reload_result = reload nginx
  return success response with test output and reload output
```

The important behavior: do not reload Nginx when `nginx -t` fails.

## Command Execution Rules

Use Python's `subprocess.run()` with list arguments, not shell strings.

Good:

```python
subprocess.run([settings.nginx_bin, "-t"], capture_output=True, text=True)
```

Avoid:

```python
subprocess.run(f"{settings.nginx_bin} -t", shell=True)
```

For reload, command handling is trickier because macOS and Ubuntu differ.

For a first version, support a list-based reload command in config:

```python
reload_cmd = ["brew", "services", "reload", "nginx"]
```

Ubuntu:

```python
reload_cmd = ["systemctl", "reload", "nginx"]
```

Return this shape from command calls:

```json
{
  "command": "nginx -t",
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "ok": true
}
```

The UI can render this directly.

## Enable Site

Enabling a site means creating a symlink:

```text
sites-enabled/{site_name}.conf -> sites-available/{site_name}.conf
```

Implementation notes:

- If the symlink already exists, treat it as already enabled.
- If a regular file exists at the enabled path, fail safely.
- After enabling, run `nginx -t`.
- If the test fails, remove only the symlink you created.
- Reload only after a passing test.

## Disable Site

Disabling a site means removing the symlink from `sites-enabled`.

Implementation notes:

- Only remove symlinks.
- Do not delete the file from `sites-available` in the first version.
- Run `nginx -t` after disabling.
- Reload only if the test passes.

This makes disable reversible.

## Error Log Endpoint

For `GET /nginx/error-log?lines=100`, read the configured error log and return the last N lines.

The simplest implementation can read the file and slice lines:

```python
lines = path.read_text(errors="replace").splitlines()
return {"lines": lines[-100:]}
```

For huge logs, switch to a tail-style implementation later.

## Local macOS Setup

Install Nginx:

```bash
brew install nginx
```

Check where Brew installed it:

```bash
brew --prefix
```

If the prefix is `/opt/homebrew`, create:

```bash
mkdir -p /opt/homebrew/etc/nginx/sites-available
mkdir -p /opt/homebrew/etc/nginx/sites-enabled
```

If the prefix is `/usr/local`, create:

```bash
mkdir -p /usr/local/etc/nginx/sites-available
mkdir -p /usr/local/etc/nginx/sites-enabled
```

Edit the Brew Nginx `nginx.conf` and add this inside the `http` block:

```nginx
include sites-enabled/*;
```

Then test:

```bash
nginx -t
```

Start or reload Nginx:

```bash
brew services start nginx
brew services reload nginx
```

## Ubuntu Setup

Ubuntu normally already has the expected folders:

```bash
sudo apt update
sudo apt install nginx
ls /etc/nginx/sites-available
ls /etc/nginx/sites-enabled
```

The FastAPI process will need permission to:

- write to `/etc/nginx/sites-available`
- create and remove symlinks in `/etc/nginx/sites-enabled`
- run `nginx -t`
- run `systemctl reload nginx`
- read `/var/log/nginx/error.log`

For a quick prototype, you can run the API with `sudo`. For anything longer lived, use a service user plus explicit `sudoers` permissions.

## Suggested Build Order

1. Create the FastAPI app skeleton.
2. Add settings from `.env`.
3. Add the Jinja2 reverse proxy template.
4. Implement template rendering and local save to `generated-sites/`.
5. Implement copy to `sites-available`.
6. Implement symlink enable and disable.
7. Implement `nginx -t` command runner.
8. Implement reload only after successful test.
9. Add error log tail endpoint.
10. Add simple JSON responses that include command output.

Do not build authentication, HTTPS automation, Docker, metrics, or a database in the first iteration. File-based state is enough for tonight.

## Nice Second Iteration

After the first version works:

- Add authentication.
- Add HTTPS with Certbot.
- Add per-site access and error logs.
- Add config preview before apply.
- Add site status: available, enabled, test passing, upstream reachable.
- Add backups before overwriting configs.
- Add a rollback endpoint.
- Add a SQLite database for metadata.
- Add rate limiting and audit logs.

## Main Safety Checklist

Before reloading Nginx:

- The generated file was written successfully.
- The config was copied to `sites-available`.
- The enabled path is a symlink, not a regular file.
- `nginx -t` passed.
- The API response includes the full test output.

Before removing anything:

- Confirm the path is inside the configured Nginx directory.
- Confirm the enabled file is a symlink.
- Do not delete `sites-available` configs during disable.

## First Night Definition of Done

You are done when:

- `POST /sites` can create a reverse proxy config.
- The config appears in the local `generated-sites/` folder.
- The config appears in Nginx `sites-available`.
- A symlink appears in `sites-enabled`.
- Invalid configs return `nginx -t` output and do not reload Nginx.
- Valid configs reload Nginx.
- `POST /sites/{site_name}/disable` removes the symlink.
- `GET /nginx/error-log?lines=100` returns recent error log lines.

