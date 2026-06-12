# ToneDeck

Per-album parametric EQ for macOS. A daemon controls [CamillaDSP](https://github.com/HEnquist/camilladsp) with per-album biquad filter presets; a CLI (`tonedeck`) applies and inspects presets from the terminal; a React UI provides a visual editor; and a Claude skill automates preset generation from audio analysis.

## Dev commands

    npm install           # install all workspace dependencies
    npm run build         # build all packages (shared → daemon, cli, ui)
    npm test              # run tests (vitest)
    npm run typecheck     # typecheck all TypeScript packages
    npm run dev:daemon    # build shared then run daemon in watch mode (tsx)
