<?php
declare(strict_types=1);

$uri = urldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');

if (strpos($uri, '/api/') === 0) {
    require __DIR__ . '/src/api.php';
    exit;
}

$public = __DIR__ . '/public';
$static = $public . $uri;
if ($uri !== '/' && is_file($static)) {
    $ext = strtolower(pathinfo($static, PATHINFO_EXTENSION));
    $mimes = [
        'js' => 'application/javascript; charset=utf-8',
        'css' => 'text/css; charset=utf-8',
        'svg' => 'image/svg+xml',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'webp' => 'image/webp',
        'html' => 'text/html; charset=utf-8',
    ];
    header('Content-Type: ' . ($mimes[$ext] ?? 'application/octet-stream'));
    header('Cache-Control: public, max-age=120');
    readfile($static);
    exit;
}

header('Content-Type: text/html; charset=utf-8');
readfile($public . '/index.html');
