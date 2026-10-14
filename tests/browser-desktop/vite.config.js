import { defineConfig, mergeConfig } from 'vite'
import base from '../../vite.config.js'

export default defineConfig(env => mergeConfig(base(env), { server: { watch: { ignored: ['**/.context/**', '**/desktop/resources/**', '**/desktop/dist/**'] } } }))
