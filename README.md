# Waken

Still-to-motion studio in PHP. Drop a photo, pick a camera move, queue a clip, save an MP4.

Runs on your Mac. Open it from your iPhone on the same Wi-Fi.

## One-liner (2020 MacBook Pro)

In Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/bkhynes/waken/main/setup.sh | bash
```

It installs PHP if needed, clones this repo to `~/waken`, asks once for your [xAI API key](https://console.x.ai), then prints two URLs:

- this Mac
- your iPhone (`http://YOUR-LAN-IP:8787`)

Keep that Terminal window open. On the iPhone, Safari → the iPhone URL.

### After the first run

```bash
~/waken/setup.sh
```

## Manual start

```bash
git clone https://github.com/bkhynes/waken.git
cd waken
cp .env.example .env   # put XAI_API_KEY= in there
php -d post_max_size=32M -S 0.0.0.0:8787 router.php
```

## iPhone notes

- Same Wi-Fi as the Mac
- If it will not load: System Settings → Network → Firewall — allow `php`, or switch the firewall off while you use it
- Download clip opens in Safari and saves as `waken-clip.mp4`

## API key

Video generation uses `grok-imagine-video-1.5`. The key stays in `.env` on the Mac and is never committed.
