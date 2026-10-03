# Patch v0.24

Main change: `Дата рейтинга` is now a real historical cutoff.

The second workspace, `История / симуляция`, reconstructs the rating after every
tournament in chronological order.

Local check:

```powershell
npm.cmd ci
npm.cmd run dev
```

Build:

```powershell
npm.cmd run build
```
