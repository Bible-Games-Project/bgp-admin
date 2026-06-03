# shared-workflows

Reusable GitHub Actions workflows for Bible Games Project apps.

## Available Workflows

| Workflow | Description | File |
|----------|-------------|------|
| Deploy iOS | Build, sign, and upload to App Store Connect | `deploy-ios.yml` |
| Deploy Android | Build, sign, and upload to Google Play | `deploy-android.yml` |
| Notify Telegram | Send deployment notification | `notify-telegram.yml` |
| Tag Release | Create and push a git tag | `tag-release.yml` |

## Usage

In each project repo, create `.github/workflows/deploy.yml`:

```yaml
name: Deploy App

on:
  push:
    branches: [deploy-app]
  pull_request:
    branches: [main]
    types: [closed]
  workflow_dispatch:
    inputs:
      deploy_ios:
        description: "Deploy iOS"
        type: boolean
        default: false
      deploy_android:
        description: "Deploy Android"
        type: boolean
        default: false

jobs:
  ios:
    if: |
      github.ref == 'refs/heads/deploy-app' ||
      (github.event_name == 'pull_request' && github.event.pull_request.merged == true) ||
      (github.event_name == 'workflow_dispatch' && inputs.deploy_ios == true)
    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-ios.yml@main
    secrets:
      IOS_BUILD_CERTIFICATE_BASE64: ${{ secrets.IOS_BUILD_CERTIFICATE_BASE64 }}
      IOS_P12_PASSWORD: ${{ secrets.IOS_P12_PASSWORD }}
      IOS_BUILD_PROVISION_PROFILE_BASE64: ${{ secrets.IOS_BUILD_PROVISION_PROFILE_BASE64 }}
      IOS_KEYCHAIN_PASSWORD: ${{ secrets.IOS_KEYCHAIN_PASSWORD }}
      IOS_EXPORT_OPTIONS_PLIST: ${{ secrets.IOS_EXPORT_OPTIONS_PLIST }}
      APP_STORE_CONNECT_API_KEY_ID: ${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}
      APP_STORE_CONNECT_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
      APP_STORE_CONNECT_API_KEY_BASE64: ${{ secrets.APP_STORE_CONNECT_API_KEY_BASE64 }}

  android:
    if: |
      github.ref == 'refs/heads/deploy-app' ||
      (github.event_name == 'pull_request' && github.event.pull_request.merged == true) ||
      (github.event_name == 'workflow_dispatch' && inputs.deploy_android == true)
    uses: Bible-Games-Project/bgp-admin/.github/workflows/deploy-android.yml@main
    with:
      package-name: com.your.package.name    # ← CHANGE THIS
    secrets:
      ANDROID_KEYSTORE: ${{ secrets.ANDROID_KEYSTORE }}
      KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
      KEY_ALIAS: ${{ secrets.KEY_ALIAS }}
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}

  notify:
    needs: [ios, android]
    if: always() && (needs.ios.result == 'success' || needs.android.result == 'success')
    uses: Bible-Games-Project/bgp-admin/.github/workflows/notify-telegram.yml@main
    with:
      app-name: "Your App Name"              # ← CHANGE THIS
    secrets:
      TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
      TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}

  tag:
    needs: [ios, android]
    if: always() && (needs.ios.result == 'success' || needs.android.result == 'success')
    uses: Bible-Games-Project/bgp-admin/.github/workflows/tag-release.yml@main
```

## Repository Setup

### 1. This repo is already created

This is the `Bible-Games-Project/bgp-admin` repo, which also serves as the central workflows repository.

### 2. Allow access from other repos

Go to **Settings → Actions → General** in this repo and set:
- **Access**: "Accessible from repositories in the Bible-Games-Project organization"

### 3. Required secrets per project repo

#### iOS Secrets
| Secret | Description |
|--------|-------------|
| `IOS_BUILD_CERTIFICATE_BASE64` | Apple Distribution certificate (.p12) encoded in base64 |
| `IOS_P12_PASSWORD` | Password for the .p12 certificate |
| `IOS_BUILD_PROVISION_PROFILE_BASE64` | Provisioning profile (.mobileprovision) in base64 |
| `IOS_KEYCHAIN_PASSWORD` | Any random password for CI keychain |
| `IOS_EXPORT_OPTIONS_PLIST` | ExportOptions.plist in base64 |
| `APP_STORE_CONNECT_API_KEY_ID` | App Store Connect API Key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | App Store Connect Issuer ID |
| `APP_STORE_CONNECT_API_KEY_BASE64` | .p8 API key file in base64 |

#### Android Secrets
| Secret | Description |
|--------|-------------|
| `ANDROID_KEYSTORE` | Release keystore file in base64 |
| `KEYSTORE_PASSWORD` | Keystore password |
| `KEY_ALIAS` | Key alias name |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Service account JSON for Play Console |

#### Shared Secrets
| Secret | Description |
|--------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for notifications |
| `TELEGRAM_CHAT_ID` | Telegram chat/group ID |

> **Tip**: If you move to a GitHub Organization, you can set shared secrets (Telegram, App Store Connect API key) at org level and use `secrets: inherit` instead of listing each one.

## Project Capacitor Setup

Each project needs Capacitor configured before the deploy workflows will work:

```bash
# Install Capacitor
bun add @capacitor/core @capacitor/cli @capacitor/assets

# Initialize (creates capacitor.config.ts)
bunx cap init "Eden Choice Chronicles" "com.biblegames.eden"

# Add platforms
bunx cap add ios
bunx cap add android

# Create assets directory for icon and splash screen
mkdir -p assets
touch assets/.gitkeep

# Build web assets first, then sync
bun run build
bunx cap sync
```

> **Note**: The `assets/` directory is used by bgp-admin to store your app icon and splash screen source images. The bgp-admin panel will:
> 1. Upload your source images (logo.png, splash.png, etc.) to the `assets/` folder via GitHub API
> 2. Trigger the `generate-assets.yml` GitHub Action workflow
> 3. The workflow runs `@capacitor/assets` to automatically generate all required sizes for iOS and Android
> 4. The generated assets are committed and pushed back to your repository
>
> This two-step approach (upload source → trigger workflow) is necessary because bgp-admin runs on Cloudflare Workers (which doesn't support git clone or native binaries), while the asset generation requires Node.js and Sharp (a native image processing library).

### Asset Generation Workflow

The `.github/workflows/generate-assets.yml` workflow is automatically created when you set up your project. It:
- Is triggered automatically by bgp-admin after uploading source images
- Can also be triggered manually from GitHub Actions tab
- Reads configuration from `assets/config.json` (background colors, etc.)
- Uses `@capacitor/assets` to generate all platform-specific sizes
- Commits and pushes the generated assets back to your repository

No manual intervention is needed - just upload your icon or splash screen through the bgp-admin panel.

### Android build.gradle setup for signing

In `android/app/build.gradle`, add above `android {`:

```groovy
def keystorePropertiesFile = rootProject.file("key.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

And inside `android { ... }`:

```groovy
signingConfigs {
    release {
        if (keystorePropertiesFile.exists()) {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
        }
    }
}

buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

## Versioning Strategy

- `package.json` version format: `MAJOR.MINOR.PATCH`
- On CI, PATCH is replaced with `GITHUB_RUN_NUMBER`
- iOS: `CFBundleShortVersionString` = `MAJOR.MINOR`, `CFBundleVersion` = `MAJOR.MINOR.RUN_NUMBER`
- Android: `versionCode` = `RUN_NUMBER + offset`, `versionName` = full version from package.json

## Updating Workflows

When you update a workflow in this repo:
- All projects using `@main` get the update on their next run automatically
- To pin a version: use `@v1.0.0` or a commit SHA instead of `@main`
- To test changes: use a branch reference like `@feature/new-telegram-format`
