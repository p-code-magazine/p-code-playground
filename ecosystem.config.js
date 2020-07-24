module.exports = {
  apps : [
      {
        name: "p-code-playground",
        script: "./index.js",
        watch: true,
        ignore_watch: [
          'logs'
        ],
        env: {
            "PORT": 8080,
            "NODE_ENV": "development"
        },
        env_production: {
            "PORT": 8080,
            "NODE_ENV": "production",
        }
      }
  ]
}
