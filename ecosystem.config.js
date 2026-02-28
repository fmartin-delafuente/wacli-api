module.exports = {
    apps: [
        {
            name: 'wacli-api',
            script: 'src/index.js',
            cwd: '/root/wacli-api',
            env: {
                NODE_ENV: 'production',
                PORT: 3001,
                WACLI_BIN: '/usr/local/bin/wacli',
                WACLI_STORE: '/root/.wacli',
                MEDIA_DIR: '/root/wacli-api/media',
                POLL_INTERVAL: 30000,
            },
            max_memory_restart: '256M',
            restart_delay: 3000,
            max_restarts: 10,
        }
    ]
};
