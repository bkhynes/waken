<?php
declare(strict_types=1);

load_env(dirname(__DIR__) . '/.env');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if ($method === 'GET' && $path === '/api/status') {
    json_out(['available' => api_key() !== '']);
}

if ($method === 'POST' && $path === '/api/start') {
    $data = json_body();
    $image = isset($data['imageDataUrl']) && is_string($data['imageDataUrl']) ? $data['imageDataUrl'] : '';
    $prompt = isset($data['prompt']) && is_string($data['prompt']) ? trim($data['prompt']) : '';
    $duration = isset($data['duration']) ? (int) $data['duration'] : 6;
    $resolution = isset($data['resolution']) && is_string($data['resolution']) ? $data['resolution'] : '720p';
    $aspect = isset($data['aspectRatio']) && is_string($data['aspectRatio']) ? $data['aspectRatio'] : '16:9';

    if (strlen($image) < 32 || strlen($image) > 3_500_000) {
        json_out(['ok' => false, 'error' => 'Still is missing or too large.'], 400);
    }
    if (strlen($prompt) < 8 || strlen($prompt) > 2500) {
        json_out(['ok' => false, 'error' => 'Prompt is invalid.'], 400);
    }
    if (!in_array($duration, [6, 10, 15], true)) {
        json_out(['ok' => false, 'error' => 'Length is invalid.'], 400);
    }
    if (!in_array($resolution, ['480p', '720p', '1080p'], true)) {
        json_out(['ok' => false, 'error' => 'Grade is invalid.'], 400);
    }
    if (!in_array($aspect, ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'], true)) {
        json_out(['ok' => false, 'error' => 'Aspect is invalid.'], 400);
    }

    $key = api_key();
    if ($key === '') {
        json_out(['ok' => false, 'error' => 'Add your xAI API key to .env first.']);
    }

    $payload = [
        'model' => 'grok-imagine-video-1.5',
        'prompt' => $prompt,
        'image' => ['url' => $image],
        'duration' => $duration,
        'aspect_ratio' => $aspect,
        'resolution' => $resolution,
    ];

    $res = xai_request('POST', 'https://api.x.ai/v1/videos/generations', $payload);
    if ($res['status'] >= 500) {
        $res = xai_request('POST', 'https://api.x.ai/v1/videos/generations', $payload);
    }
    if ($res['status'] < 200 || $res['status'] >= 300) {
        json_out(['ok' => false, 'error' => extract_error($res['json'], 'Could not queue the clip (' . $res['status'] . ').')]);
    }
    $requestId = $res['json']['request_id'] ?? null;
    if (!is_string($requestId) || strlen($requestId) < 8) {
        json_out(['ok' => false, 'error' => 'The studio did not return a job id.']);
    }
    json_out(['ok' => true, 'requestId' => $requestId]);
}

if ($method === 'POST' && $path === '/api/poll') {
    $data = json_body();
    $requestId = isset($data['requestId']) && is_string($data['requestId']) ? $data['requestId'] : '';
    if (strlen($requestId) < 8 || strlen($requestId) > 128) {
        json_out(['ok' => false, 'error' => 'Job id is invalid.'], 400);
    }
    $key = api_key();
    if ($key === '') {
        json_out(['ok' => false, 'error' => 'Add your xAI API key to .env first.']);
    }

    $res = xai_request('GET', 'https://api.x.ai/v1/videos/' . rawurlencode($requestId), null);
    if ($res['status'] < 200 || $res['status'] >= 300) {
        json_out(['ok' => false, 'error' => extract_error($res['json'], 'Could not check the job (' . $res['status'] . ').')]);
    }

    $rec = is_array($res['json']) ? $res['json'] : [];
    $status = strtolower((string) ($rec['status'] ?? ''));
    $progress = (int) round((float) ($rec['progress'] ?? 0));
    $progress = max(0, min(100, $progress));

    if ($status === 'done') {
        $url = $rec['video']['url'] ?? null;
        if (!is_string($url) || strpos($url, 'http') !== 0) {
            json_out(['ok' => false, 'error' => 'The clip finished but no file was returned.']);
        }
        json_out(['ok' => true, 'status' => 'done', 'progress' => 100, 'videoUrl' => $url]);
    }
    if ($status === 'failed' || $status === 'expired') {
        json_out(['ok' => false, 'error' => extract_error($rec, $status === 'expired' ? 'The job expired.' : 'Rendering failed.')]);
    }
    json_out([
        'ok' => true,
        'status' => 'rendering',
        'progress' => $status === 'pending' ? max($progress, 4) : max($progress, 12),
    ]);
}

if ($method === 'GET' && $path === '/api/clip') {
    $src = isset($_GET['src']) && is_string($_GET['src']) ? $_GET['src'] : '';
    $name = safe_filename(isset($_GET['name']) && is_string($_GET['name']) ? $_GET['name'] : 'waken-clip.mp4');
    if ($src === '') {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Missing clip.';
        exit;
    }
    $remote = parse_url($src);
    if (!is_array($remote) || empty($remote['host']) || ($remote['scheme'] ?? '') !== 'https') {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Clip host is not allowed.';
        exit;
    }
    if (is_private_host((string) $remote['host'])) {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Clip host is not allowed.';
        exit;
    }

    $upstream = fetch_public_video($src);
    if ($upstream === null) {
        http_response_code(502);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Could not fetch the clip.';
        exit;
    }

    header('Content-Type: ' . $upstream['type']);
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Cache-Control: private, max-age=300');
    header('X-Content-Type-Options: nosniff');
    if ($upstream['length'] !== null) {
        header('Content-Length: ' . $upstream['length']);
    }
    echo $upstream['body'];
    exit;
}

http_response_code(404);
header('Content-Type: application/json');
echo json_encode(['ok' => false, 'error' => 'Not found.']);
exit;

function load_env(string $path): void
{
    if (!is_file($path)) {
        return;
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    if ($lines === false) {
        return;
    }
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        $eq = strpos($line, '=');
        if ($eq === false) {
            continue;
        }
        $k = trim(substr($line, 0, $eq));
        $v = trim(substr($line, $eq + 1));
        $v = trim($v, "\"'");
        if ($k !== '' && getenv($k) === false) {
            putenv($k . '=' . $v);
        }
    }
}

function api_key(): string
{
    $key = getenv('XAI_API_KEY');
    return is_string($key) ? trim($key) : '';
}

function json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function json_out(array $data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data);
    exit;
}

function extract_error($payload, string $fallback): string
{
    if (!is_array($payload)) {
        return $fallback;
    }
    $err = $payload['error'] ?? null;
    if (is_string($err) && trim($err) !== '') {
        return $err;
    }
    if (is_array($err) && isset($err['message']) && is_string($err['message']) && trim($err['message']) !== '') {
        return $err['message'];
    }
    if (isset($payload['message']) && is_string($payload['message']) && trim($payload['message']) !== '') {
        return $payload['message'];
    }
    return $fallback;
}

function xai_request(string $method, string $url, ?array $body): array
{
    $key = api_key();
    $ch = curl_init($url);
    $headers = ['Authorization: Bearer ' . $key];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $json = null;
    if (is_string($raw) && $raw !== '') {
        $decoded = json_decode($raw, true);
        $json = is_array($decoded) ? $decoded : ['message' => substr($raw, 0, 240)];
    }
    return ['status' => $status, 'json' => $json];
}

function safe_filename(string $raw): string
{
    $cleaned = preg_replace('/[^\w.\-]+/', '_', $raw) ?? 'waken-clip.mp4';
    $cleaned = substr($cleaned, 0, 80);
    if ($cleaned === '') {
        $cleaned = 'waken-clip.mp4';
    }
    if (strtolower(substr($cleaned, -4)) !== '.mp4') {
        $cleaned .= '.mp4';
    }
    return $cleaned;
}

function is_private_host(string $hostname): bool
{
    $host = strtolower(trim($hostname, '[]'));
    if ($host === 'localhost' || substr($host, -10) === '.localhost' || substr($host, -6) === '.local') {
        return true;
    }
    if ($host === '::1' || $host === '0.0.0.0') {
        return true;
    }
    if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        $p = array_map('intval', explode('.', $host));
        if ($p[0] === 10 || $p[0] === 127 || $p[0] === 0) {
            return true;
        }
        if ($p[0] === 169 && $p[1] === 254) {
            return true;
        }
        if ($p[0] === 192 && $p[1] === 168) {
            return true;
        }
        if ($p[0] === 172 && $p[1] >= 16 && $p[1] <= 31) {
            return true;
        }
    }
    if (strpos($host, 'fc') === 0 || strpos($host, 'fd') === 0 || strpos($host, 'fe80') === 0) {
        return true;
    }
    return false;
}

function fetch_public_video(string $start): ?array
{
    $current = $start;
    for ($i = 0; $i < 4; $i++) {
        $parts = parse_url($current);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || is_private_host((string) $parts['host'])) {
            return null;
        }
        $ch = curl_init($current);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HEADER => true,
            CURLOPT_TIMEOUT => 90,
            CURLOPT_HTTPHEADER => ['Accept: video/mp4,video/webm,video/*,*/*'],
        ]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);
        if (!is_string($raw)) {
            return null;
        }
        $headerBlob = substr($raw, 0, $headerSize);
        $body = substr($raw, $headerSize);
        if ($status >= 300 && $status < 400) {
            if (!preg_match('/^location:\s*(.+)$/im', $headerBlob, $m)) {
                return null;
            }
            $loc = trim($m[1]);
            $current = resolve_url($current, $loc);
            continue;
        }
        if ($status < 200 || $status >= 300 || $body === '') {
            return null;
        }
        $type = 'video/mp4';
        if (preg_match('/^content-type:\s*([^;\s]+)/im', $headerBlob, $tm)) {
            $cand = trim($tm[1]);
            if (strpos($cand, 'video') !== false || strpos($cand, 'octet') !== false) {
                $type = $cand;
            }
        }
        $length = null;
        if (preg_match('/^content-length:\s*(\d+)/im', $headerBlob, $lm)) {
            $length = $lm[1];
        }
        return ['body' => $body, 'type' => $type, 'length' => $length];
    }
    return null;
}

function resolve_url(string $base, string $rel): string
{
    if (preg_match('#^https?://#i', $rel)) {
        return $rel;
    }
    $p = parse_url($base);
    $scheme = $p['scheme'] ?? 'https';
    $host = $p['host'] ?? '';
    if (strpos($rel, '/') === 0) {
        return $scheme . '://' . $host . $rel;
    }
    $dir = rtrim(dirname($p['path'] ?? '/'), '/');
    return $scheme . '://' . $host . $dir . '/' . $rel;
}
