# Deployment Secrets Setup Guide

This guide explains **which secrets you need** and **where to configure them** so deployments work from the bgp-admin panel.

---

## 📊 Overall Status

**Total progress:** 14/14 secrets configured (100%) ✅

- ✅ **bgp-admin**: 1/1 (100%)
- ✅ **iOS Organization**: 7/7 (100%)
- ✅ **iOS Repository (per app)**: 2/2 (100%)
- ✅ **Android Organization**: 1/1 (100%)
- ✅ **Android Repository (per app)**: 3/3 (100%)

🎉 **All secrets are configured. The deployment system is fully operational.**

---

## 🚦 Quick Start - Where to Begin

### Recommended order:

1. **GITHUB_PAT** - Personal Access Token for the admin panel
2. **iOS** (if deploying iOS first):
   - Certificate + Profile (steps 1-3)
   - ExportOptions.plist (step 5)
   - App Store Connect API (steps 6-8)
   - Temporary password (step 4)
3. **Android** (if deploying Android first):
   - Keystore (steps 1-3)
   - Google Play Service Account (step 4)

💡 **Tip:** You can configure only iOS or only Android first to test the deployment before doing both.

### 📝 Note about base64 commands:

All commands in this guide use the **macOS/Linux** format:
```bash
base64 -i file.ext | pbcopy
```

If you don't have `pbcopy` (Linux without macOS), use:
```bash
base64 -i file.ext
# Copy the output manually
```

---

## 🔑 Summary of Required Secrets

### 1. In **bgp-admin** (to trigger deploys)
- [x] `GITHUB_PAT` - Personal Access Token to call the GitHub API ✅

### 2. In **Bible-Games-Project Organization** (shared)

#### iOS Organization secrets (7):
- [x] `IOS_TEAM_ID` ✅
- [x] `IOS_BUILD_CERTIFICATE_BASE64` ✅
- [x] `IOS_P12_PASSWORD` ✅
- [x] `IOS_KEYCHAIN_PASSWORD` ✅
- [x] `APP_STORE_CONNECT_API_KEY_ID` ✅
- [x] `APP_STORE_CONNECT_ISSUER_ID` ✅
- [x] `APP_STORE_CONNECT_API_KEY_BASE64` ✅

#### Android Organization secrets (1):
- [x] `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` ✅

### 3. In **eden-choice-chronicles Repository** (app-specific)

#### iOS Repository secrets (2):
- [x] `IOS_BUILD_PROVISION_PROFILE_BASE64` ✅
- [x] `IOS_EXPORT_OPTIONS_PLIST` ✅

#### Android Repository secrets (3):
- [x] `ANDROID_KEYSTORE` ✅ (unique keystore for Eden)
- [x] `KEYSTORE_PASSWORD` ✅ (password for Eden's keystore)
- [x] `KEY_ALIAS` ✅ (alias: "eden")

---

## 🎯 Configuration Levels - IMPORTANT

### Where each secret goes:

| Secret | Level | Exact Location |
|--------|-------|----------------|
| `GITHUB_PAT` | **Environment Variable** | Lovable Cloud → bgp-admin project → Settings → Environment Variables |
| Shared iOS secrets | **Organization Level** | GitHub → Bible-Games-Project (org) → Settings → Secrets → Actions → Organization secrets |
| App-specific iOS secrets | **Repository Level** | GitHub → eden-choice-chronicles → Settings → Secrets → Actions → Repository secrets |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | **Organization Level** | GitHub → Bible-Games-Project (org) → Settings → Secrets → Actions → Organization secrets |
| App-specific Android secrets | **Repository Level** | GitHub → eden-choice-chronicles → Settings → Secrets → Actions → Repository secrets |

### Organization-level secrets (shared across projects):

✅ **iOS - Shared for all apps:**
- `IOS_TEAM_ID` - Apple Developer Team ID (organization identifier)
- `IOS_BUILD_CERTIFICATE_BASE64` - Same certificate for all apps
- `IOS_P12_PASSWORD` - Certificate password
- `IOS_KEYCHAIN_PASSWORD` - Temporary GitHub Actions password
- `APP_STORE_CONNECT_API_KEY_ID` - Shared API Key
- `APP_STORE_CONNECT_ISSUER_ID` - Shared Issuer
- `APP_STORE_CONNECT_API_KEY_BASE64` - Shared API Key

✅ **Android - Shared (Google Play only):**
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` - Shared service account for uploading to Play Store

### Repository-level secrets (app-specific):

⚠️ **iOS - App-specific (per app):**
- `IOS_BUILD_PROVISION_PROFILE_BASE64` - Specific profile for the app bundle ID
- `IOS_EXPORT_OPTIONS_PLIST` - Specific export configuration

⚠️ **Android - App-specific (per app):**
- `ANDROID_KEYSTORE` - Unique keystore file for this app (.jks in base64)
- `KEYSTORE_PASSWORD` - Password for this app's keystore
- `KEY_ALIAS` - Alias inside this keystore (typically the app name)

**Benefits of using Organization level:**
- ✅ Configure once, use in multiple repos (Eden, Lost Sheep, etc.)
- ✅ Update certificates/keys in a single place
- ✅ Easier to maintain long-term
- ✅ Ideal when you have multiple projects

---

## 📋 Detailed Configuration

## 1️⃣ bgp-admin - GitHub PAT ✅

**Level:** Environment Variable (Lovable Cloud)
**Exact location:** https://lovable.dev → bgp-admin project → Settings → Environment Variables

### Secret:
- [x] `GITHUB_PAT` ✅

### Completed steps:

- [x] Go to GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
- [x] Create token with:
  - [x] **Repository access**: All repositories under `Bible-Games-Project` organization (or select specific app repos)
  - [x] **Permissions**: 
    - [x] **Actions** - Read and write (required for triggering centralized asset generation workflow)
    - [x] **Contents** - Read and write (required for uploading asset files and cloning app repos)
  - [x] **Expiration**: Configured
- [x] Token copied
- [x] Configured in Lovable Cloud (Environment Variables → GITHUB_PAT)
- [x] **Also configured as GitHub Secret in bgp-admin repository**: Go to https://github.com/Bible-Games-Project/bgp-admin/settings/secrets/actions → New repository secret → Name: `GITHUB_PAT`, Value: (paste token)

**Note:** The asset management feature (icon and splash screen) works as follows:
1. BGP Admin uploads the source images to `assets/` via GitHub Contents API (to the app repo)
2. BGP Admin triggers the centralized `generate-assets.yml` workflow in bgp-admin
3. The workflow clones the app repository using GITHUB_PAT, runs `@capacitor/assets`, and pushes back
4. ✅ All asset sizes are generated and committed to the app repository

This centralized approach means:
- ✅ No workflow files needed in individual app repositories
- ✅ All logic stays in bgp-admin
- ✅ Works in Cloudflare Workers runtime (production) because it only uses HTTP APIs
- ⚠️ The GITHUB_PAT must have access to both bgp-admin AND all app repositories

---

## 2️⃣ iOS Secrets

### Part A: Organization-level secrets (shared)

**Level:** Organization secrets
**Exact location:**
1. Go to: https://github.com/organizations/Bible-Games-Project/settings/secrets/actions
2. Click **"New organization secret"**
3. For each shared secret (certificates, API keys):
   - Name: `SECRET_NAME`
   - Secret: `base64_value`
   - Repository access: **"All repositories"** or select specific repos
   - Click **"Add secret"**

**Configure these 7 secrets at Organization level:**

#### 1. `IOS_TEAM_ID` ✅

**What it is:** Your Apple Developer Team ID (10 characters). This identifies your organization in Apple's systems.

**How to find it:**

**Option A - From App Store Connect:**
1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Click your name (top right) → **View Membership**
3. Look for **Team ID** (e.g., `N65TK8GHAL`)

**Option B - From Apple Developer Portal:**
1. Go to [Apple Developer - Membership](https://developer.apple.com/account)
2. Scroll down to **Membership Information**
3. Look for **Team ID**

**Option C - From your existing certificate:**
```bash
# If you have an Apple Distribution certificate installed:
security find-identity -v -p codesigning | grep "Apple Distribution"
# The Team ID is in parentheses at the end, e.g., (N65TK8GHAL)
```

**Value to use:**
- Just the Team ID: `N65TK8GHAL` (example for Joan Sabé's team)
- **Do NOT use:** The full team name or anything else

**Set this secret:**
- Name: `IOS_TEAM_ID`
- Value: `N65TK8GHAL` (your actual Team ID)
- Repository access: **All repositories**

- [x] Team ID identified ✅
- [x] Secret created at Organization level ✅

---

#### 2. `IOS_BUILD_CERTIFICATE_BASE64` ✅

**Step by step to obtain the .p12 certificate:**

1. **Download the certificate from Apple Developer Portal:**
   - Go to https://developer.apple.com/account/resources/certificates
   - **For Eden Choice Chronicles (new app):** Use the **"Distribution Managed"** certificate from 2026/08/15
   - Look for a **"Distribution Managed"** (recommended) or **"Apple Distribution"** certificate
   - If you don't have one, create it:
     - Click **"+"**
     - Select **"Apple Distribution"**
     - Follow the steps (you'll need to create a Certificate Signing Request in Keychain Access)
   - Download the certificate (.cer)

2. **Install the certificate on your Mac:**
   - Double-click the downloaded .cer file
   - Keychain Access will open and install it in the "login" keychain

3. **Export the certificate with the private key as .p12:**
   - Open **Keychain Access**
   - In the left sidebar, select **"My Certificates"**
   - Find the certificate "Apple Distribution: Your Name (Team ID)"
   - **Important:** Expand the certificate (click the arrow ▸) - it must have a **private key** below it
     - If it does NOT have a private key, the certificate won't work - you need to create it from this Mac
   - Right-click the certificate → **"Export"**
   - Format: **Personal Information Exchange (.p12)**
   - Save as `ios-dist-certificate.p12`
   - It will ask for a password - **make one up and save it** (you'll need it for IOS_P12_PASSWORD)

4. **Convert the .p12 to base64:**
   ```bash
   base64 -i ios-dist-certificate.p12 | pbcopy
   ```

- [x] Certificate downloaded and installed ✅
- [x] Exported to .p12 with private key ✅
- [x] Converted to base64 ✅
- [x] Added as `IOS_BUILD_CERTIFICATE_BASE64` secret in GitHub ✅

---

#### 3. `IOS_P12_PASSWORD` ✅

**The password you used when exporting the .p12 in the previous step.**

- [x] Added the password as `IOS_P12_PASSWORD` secret in GitHub ✅

---

#### 4. `IOS_KEYCHAIN_PASSWORD` ✅

**A temporary password that GitHub Actions will use internally.**

- Make up any password (e.g., `TemporalGHA123!`)
- You don't need to save it for anything else

- [x] Password invented ✅
- [x] Added as `IOS_KEYCHAIN_PASSWORD` secret in GitHub ✅

---

#### 5. `APP_STORE_CONNECT_API_KEY_ID` ✅

**Step by step to obtain the App Store Connect API Key:**

1. **Go to App Store Connect:**
   - https://appstoreconnect.apple.com/access/integrations/api
   - (You need Admin or Account Holder role)

2. **Create an API Key:**
   - If you already have one, you can reuse it
   - Otherwise, click **"+"** (Generate API Key)
   - Name: "GitHub Actions Deploy"
   - Access: **App Manager** (or Admin if you prefer)
   - Click **"Generate"**

3. **Copy the Key ID:**
   - You'll see something like `ABC123DEF4` - copy it
   - Format: 10 alphanumeric characters

- [x] API Key created ✅
- [x] Key ID copied (e.g., `ABC123DEF4`) ✅
- [x] Added as `APP_STORE_CONNECT_API_KEY_ID` secret in GitHub (no quotes) ✅

---

#### 6. `APP_STORE_CONNECT_ISSUER_ID` ✅

**On the same API Keys page:**

1. Above the list of keys you'll see: **"Issuer ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"**
2. Copy that full UUID

- [x] Issuer ID copied (UUID format) ✅
- [x] Added as `APP_STORE_CONNECT_ISSUER_ID` secret in GitHub ✅

---

#### 7. `APP_STORE_CONNECT_API_KEY_BASE64` ✅

**Download the .p8 file of the API Key:**

1. **Download the private key:**
   - On the same API Keys page
   - Click **"Download API Key"** next to the key you created
   - A file `AuthKey_ABC123DEF4.p8` will be downloaded
   - ⚠️ **IMPORTANT**: It can only be downloaded ONCE
   - If you already downloaded it before, use that saved file
   - If you lost it, you'll have to create a new API Key

2. **Convert to base64:**
   ```bash
   base64 -i AuthKey_ABC123DEF4.p8 | pbcopy
   ```

- [x] .p8 file downloaded ✅
- [x] Converted to base64 ✅
- [x] Added as `APP_STORE_CONNECT_API_KEY_BASE64` secret in GitHub ✅

---

### Part B: Repository-level secrets (app-specific)

**Level:** Repository secrets
**Exact location:**
1. Go to: https://github.com/Bible-Games-Project/eden-choice-chronicles/settings/secrets/actions
2. Click **"New repository secret"** (NOT "New organization secret")

**Configure these 2 secrets at Repository level:**

#### 1. `IOS_BUILD_PROVISION_PROFILE_BASE64` ✅

**Step by step to obtain the provisioning profile:**

1. **Download the profile from Apple Developer Portal:**
   - Go to https://developer.apple.com/account/resources/profiles
   - Find your **"App Store"** or **"Ad Hoc"** profile for `com.biblegames.eden`
   - If you don't have one, create it:
     - Click **"+"**
     - Select **"App Store"**
     - App ID: `com.biblegames.eden`
     - Certificate: Select the distribution certificate you created before
     - Name: "Eden Choice Chronicles"
   - Download the profile (.mobileprovision)

2. **Note the profile name:**
   - The name you gave it (e.g., "Eden Choice Chronicles")
   - You'll need it for `ExportOptions.plist` later
   - **How to verify the exact profile name:**
     ```bash
     security cms -D -i Eden_Choice_Chronicles.mobileprovision | grep -A 1 "<key>Name</key>"
     # Will show something like:
     # <key>Name</key>
     # <string>Eden Choice Chronicles</string>
     ```

3. **Convert the .mobileprovision to base64:**
   ```bash
   base64 -i Eden_Choice_Chronicles.mobileprovision | pbcopy
   ```

- [x] Profile downloaded ✅
- [x] Profile name noted (for ExportOptions.plist) ✅
- [x] Converted to base64 ✅
- [x] Added as `IOS_BUILD_PROVISION_PROFILE_BASE64` secret at **Repository** level ✅

---

#### 2. `IOS_EXPORT_OPTIONS_PLIST` ✅

**Create a file to configure how the app is exported.**

1. **Create a file named `ExportOptions.plist`:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store</string>

    <key>teamID</key>
    <string>YOUR_TEAM_ID</string>
    <!-- ⚠️ Replace YOUR_TEAM_ID with your real Apple Developer Team ID (10 chars).
         It MUST match the team that owns the certificate and provisioning profile. -->

    <key>provisioningProfiles</key>
    <dict>
        <key>com.biblegames.eden</key>
        <string>Eden Choice Chronicles</string>
        <!-- ⚠️ IMPORTANT: Change "Eden Choice Chronicles" to the EXACT NAME
             of your provisioning profile from step 1 -->
    </dict>

    <key>signingStyle</key>
    <string>manual</string>

    <key>uploadSymbols</key>
    <true/>
</dict>
</plist>
```

2. **Convert to base64:**
```bash
base64 -i ExportOptions.plist | pbcopy
```

- [x] `ExportOptions.plist` file created ✅
- [x] Provisioning profile name updated in XML ✅
- [x] Converted to base64 ✅
- [x] Added as `IOS_EXPORT_OPTIONS_PLIST` secret at **Repository** level ✅

---

## 3️⃣ Android Secrets

### Part A: Organization-level secrets (shared)

**Level:** Organization secrets
**Exact location:**
1. Go to: https://github.com/organizations/Bible-Games-Project/settings/secrets/actions
2. Click **"New organization secret"**
3. For each shared secret:
   - Name: `SECRET_NAME`
   - Secret: `base64_value`
   - Repository access: **"All repositories"**
   - Click **"Add secret"**

**Configure these 3 secrets at Organization level:**

#### 1. `ANDROID_KEYSTORE` ✅

**Step by step to create the Android keystore:**

1. **Check if you already have a keystore:**
   - If you already published the app to Google Play, **you must use the original keystore**
   - If it's a new app, create a new one

2. **Create the keystore (if new):**
   ```bash
   keytool -genkey -v -keystore eden-release.keystore \
     -alias eden-key \
     -keyalg RSA \
     -keysize 2048 \
     -validity 10000
   ```

3. **It will ask for information:**
   ```
   Enter keystore password: [invent a secure password and SAVE IT]
   Re-enter new password: [repeat the password]

   What is your first and last name?
     [Your name or company name]

   What is the name of your organizational unit?
     [E.g., Development]

   What is the name of your organization?
     [E.g., Bible Games Project]

   What is the name of your City or Locality?
     [Your city]

   What is the name of your State or Province?
     [Your state/province]

   What is the two-letter country code for this unit?
     [E.g., ES]

   Is CN=..., OU=..., O=..., L=..., ST=..., C=... correct?
     [yes]

   Enter key password for <eden-key>
     [Press ENTER to use the same password as the keystore]
   ```

4. **Save the keystore file in a safe place:**
   - The `eden-release.keystore` file is CRITICAL
   - If you lose it, you'll never be able to update the app on Google Play
   - Save it in multiple secure locations (1Password, private Dropbox, etc.)

5. **Convert the keystore to base64:**
   ```bash
   base64 -i eden-release.keystore | pbcopy
   ```

- [x] Keystore created (or located if it already existed) ✅
- [x] Password saved in a safe place ✅
- [x] .keystore file backed up in multiple places ✅
- [x] Converted to base64 ✅
- [x] Added as `ANDROID_KEYSTORE` secret at **Organization** level in GitHub ✅

---

#### 2. `KEYSTORE_PASSWORD` ✅

**The password you used when creating the keystore.**

⚠️ **If you use an existing keystore:** You must know the original password

**Location:**
- Go to: https://github.com/organizations/Bible-Games-Project/settings/secrets/actions
- Click **"New organization secret"**

**Checklist:**
- [x] Password saved in a safe place ✅
- [x] Added as `KEYSTORE_PASSWORD` secret at **Organization** level in GitHub ✅

---

#### 3. `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` ✅

**Step by step to create the Google Play Service Account:**

1. **Create a project in Google Cloud Console:**
   - Go to https://console.cloud.google.com/
   - Click the project selector (top left)
   - Click **"NEW PROJECT"**
   - Project name: `Bible Games Project`
   - Click **"CREATE"**

2. **Enable the Google Play Android Developer API:**
   - Go to https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com
   - Make sure the correct project is selected
   - Click **"Enable"**

3. **Create the Service Account:**
   - Go to https://console.cloud.google.com/iam-admin/serviceaccounts
   - Click **"CREATE SERVICE ACCOUNT"**
   - Service account name: `github-actions-deploy`
   - Description: `Service account for automated deployments via GitHub Actions`
   - Click **"CREATE AND CONTINUE"**
   - Skip "Grant access" → Click **"CONTINUE"**
   - Skip "Grant users access" → Click **"DONE"**

4. **Download the JSON key:**
   - Click on the service account email in the list
   - Go to the **"KEYS"** tab
   - Click **"ADD KEY"** → **"Create new key"**
   - Select **"JSON"**
   - Click **"CREATE"**
   - A JSON file will download

5. **Invite the service account in Google Play Console:**
   - Go to: https://play.google.com/console/u/0/developers/YOUR_DEVELOPER_ID/users-and-permissions
   - Click **"Invite new users"**
   - Email address: `github-actions-deploy@YOUR-PROJECT.iam.gserviceaccount.com`
   - App permissions: Select **"Eden Choice Chronicles"** with:
     - ✅ View app information and download bulk reports
     - ✅ Manage testing tracks and edit tester lists
     - ✅ Manage production releases
     - ✅ Manage testing track releases
   - Click **"Invite user"**

6. **Convert the JSON to base64:**
   ```bash
   base64 -i project-id-xxxxx.json | pbcopy
   ```

- [x] Google Cloud project created ✅
- [x] Google Play Android Developer API enabled ✅
- [x] Service account created in Google Cloud ✅
- [x] JSON file downloaded ✅
- [x] Permissions granted in Google Play Console ✅
- [x] Converted to base64 ✅
- [x] Added as `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` secret at **Organization** level in GitHub ✅

---

### Part B: Repository-level secret (app-specific)

#### 1. `KEY_ALIAS` ✅

⚠️ **THIS secret goes at REPOSITORY level** (app-specific)

**The alias of the key inside the shared keystore.**

- For Eden, the alias is: `eden-key`
- For other projects, you'll use different aliases in the same keystore (e.g., `lost-sheep-key`, `didactic-jesus-key`)
- Verify the alias with:
  ```bash
  keytool -list -v -keystore eden-release.keystore
  # Will show "Alias name: eden-key"
  ```

**Location:**
- Go to: https://github.com/Bible-Games-Project/eden-choice-chronicles/settings/secrets/actions
- Click **"New repository secret"**

**Checklist:**
- [x] Alias identified (`eden-key`) ✅
- [x] Added as `KEY_ALIAS` secret at **Repository** level in eden-choice-chronicles ✅

---

## 📝 Final Configuration Checklist

### bgp-admin:
- [x] `GITHUB_PAT` configured in Lovable Cloud ✅

### Organization Secrets (Bible-Games-Project):

#### iOS Organization:
- [x] `IOS_BUILD_CERTIFICATE_BASE64` ✅
- [x] `IOS_P12_PASSWORD` ✅
- [x] `IOS_KEYCHAIN_PASSWORD` ✅
- [x] `APP_STORE_CONNECT_API_KEY_ID` ✅
- [x] `APP_STORE_CONNECT_ISSUER_ID` ✅
- [x] `APP_STORE_CONNECT_API_KEY_BASE64` ✅

#### Android Organization:
- [x] `ANDROID_KEYSTORE` ✅
- [x] `KEYSTORE_PASSWORD` ✅
- [x] `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` ✅

### Repository Secrets (eden-choice-chronicles):

#### iOS Repository:
- [x] `IOS_BUILD_PROVISION_PROFILE_BASE64` ✅
- [x] `IOS_EXPORT_OPTIONS_PLIST` ✅

#### Android Repository:
- [x] `KEY_ALIAS` ✅

---

## 🔗 Direct Configuration Links

### Configure Secrets:
| What to configure | Where to go | Type |
|-------------------|-------------|------|
| `GITHUB_PAT` | [Lovable Cloud](https://lovable.dev) → bgp-admin → Settings → Env Variables | Environment Variable |
| Shared iOS/Android secrets | [Organization Secrets](https://github.com/organizations/Bible-Games-Project/settings/secrets/actions) → **New organization secret** | Organization Secret |
| App-specific iOS/Android secrets | [eden-choice-chronicles Secrets](https://github.com/Bible-Games-Project/eden-choice-chronicles/settings/secrets/actions) → **New repository secret** | Repository Secret |

### Obtain Credentials:
| What you need | Where to get it |
|---------------|-----------------|
| GitHub PAT | [GitHub Fine-grained tokens](https://github.com/settings/tokens?type=beta) |
| iOS Certificate + Profile | [Apple Developer Portal](https://developer.apple.com/account/resources/certificates) |
| App Store Connect API Keys | [App Store Connect Keys](https://appstoreconnect.apple.com/access/integrations/api) |
| Android Keystore | Generate locally with `keytool` |
| Google Play Service Account | [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts) |

---

## ⚠️ Common Problems and Solutions

### iOS:

**"Code signing error" / "No certificate found"**
- ✅ Verify the .p12 certificate includes the private key (expand in Keychain Access)
- ✅ Make sure to export from the "login" keychain, not "System"
- ✅ The certificate must be type "Distribution Managed" or "Apple Distribution" (not "Development")
- ✅ For Eden: use the "Distribution Managed" certificate from 2026/08/15

**"Provisioning profile doesn't match"**
- ✅ The name in `ExportOptions.plist` must match EXACTLY the profile name
- ✅ The profile must be associated with the same certificate you exported
- ✅ The bundle ID in the profile must be `com.biblegames.eden`

**"App Store Connect API authentication failed"**
- ✅ Verify the Key ID has no spaces or extra characters
- ✅ The .p8 file can only be downloaded once - if you lost it, create a new key
- ✅ The API key must have "App Manager" role or higher

### Android:

**"Keystore was tampered with" / "Wrong password"**
- ✅ Verify the password is correct
- ✅ Make sure you converted the correct keystore to base64
- ✅ The base64 should not have extra line breaks

**"Google Play API error: 401"**
- ✅ Verify the service account has permissions in Google Play Console
- ✅ The JSON file must be the service account's, not another type of credential
- ✅ The "Google Play Android Developer" API must be enabled

**"The APK/AAB could not be signed"**
- ✅ Verify `KEY_ALIAS` matches the actual keystore alias
- ✅ List available aliases: `keytool -list -v -keystore your-keystore.keystore`

### General:

**The base64 is cut off or malformed**
```bash
# Mac/Linux: use -i (input) and | pbcopy (copy to clipboard)
base64 -i file.p12 | pbcopy

# If you need to save it to a file:
base64 -i file.p12 -o file.txt

# Verify it doesn't have weird line breaks:
base64 -i file.p12 | tr -d '\n' | pbcopy
```

**Can't access Apple Developer / Google Play Console**
- ✅ You need Admin or Account Holder role
- ✅ If you don't have access, ask the account owner to configure the secrets

---

## 📚 Example Values (for reference)

### What correct values look like:

| Secret | Example value | Format |
|--------|---------------|--------|
| `GITHUB_PAT` | `github_pat_11AAAA...` | String (starts with `github_pat_` or `ghp_`) |
| `IOS_BUILD_CERTIFICATE_BASE64` | `MIIKzAIBAzCCCo...` (very long) | Base64 of .p12 (several KB) |
| `IOS_P12_PASSWORD` | `MyPassword123!` | String (your password) |
| `IOS_BUILD_PROVISION_PROFILE_BASE64` | `MIIMswYJKoZI...` (very long) | Base64 of .mobileprovision (several KB) |
| `IOS_KEYCHAIN_PASSWORD` | `TempGHA2024!` | String (any password) |
| `IOS_EXPORT_OPTIONS_PLIST` | `PD94bWwgdmVyc2l...` (long) | Base64 of the XML (1-2 KB) |
| `APP_STORE_CONNECT_API_KEY_ID` | `ABC123DEF4` | 10-character string |
| `APP_STORE_CONNECT_ISSUER_ID` | `a1b2c3d4-e5f6-7890-abcd-1234567890ab` | UUID |
| `APP_STORE_CONNECT_API_KEY_BASE64` | `LS0tLS1CRUdJT...` (long) | Base64 of .p8 (~200 bytes) |
| `ANDROID_KEYSTORE` | `/u3+7QAAAAIAAAs...` (very long) | Base64 of .keystore (several KB) |
| `KEYSTORE_PASSWORD` | `MyKeystore2024!` | String (your password) |
| `KEY_ALIAS` | `eden-key` | String (simple alias) |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | `ewogICJ0eXBlIjog...` (long) | Base64 of the JSON (1-2 KB) |

### ✅ Validation checklist before adding:

- [x] The base64 has NO line breaks in the middle (must be a continuous string)
- [x] Passwords have NO leading or trailing spaces
- [x] IDs (Key ID, Issuer ID) have NO quotes
- [x] The Android alias is in lowercase (generally)
- [x] Long base64 values (certificates, keystores) are several KB in size

---

## 🚀 Verify That It Works

1. Make sure all secrets are configured ✅
2. Go to the bgp-admin panel
3. Log in
4. Press "Deploy iOS" or "Deploy Android"
5. Go to GitHub Actions in eden-choice-chronicles to see the workflow running

If something fails, check the logs in GitHub Actions to see which secret is missing or misconfigured.
