import { mergeConfig } from 'vite'
import base from '../../vite.config.js'

export default mergeConfig(base, { server: { watch: { ignored: ['**/.context/**', '**/desktop/resources/**', '**/desktop/dist/**'] } } })
