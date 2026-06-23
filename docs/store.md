---
title: "Nimble Character Sheet"
description: "Interactive character sheet for the Nimble TTRPG."
author: Aurélia PIC (Aur3liaP)
image: "https://nimble-obr.vercel.app/header.png"
icon: "https://nimble-obr.vercel.app/icon.svg"
tags:
  - Nimble
  - Character sheet
  - Utility
  - Dice
manifest: "https://nimble-obr.vercel.app/manifest.json"
learn-more: "https://github.com/Aur3liaP/nimble-obr"
---

# Nimble Character Sheet

An interactive, real-time character sheet designed specifically for the **Nimble TTRPG** system.

This extension provides a seamless way for players and GMs to manage character stats, skills, and combat actions directly within Owlbear Rodeo.

## Features

- **Real-Time Syncing**: Every HP change, inventory update, or stat modification is instantly synced between the player and the GM using OBR's metadata.
- **Dynamic Dice Roller**: Roll attributes, saves, and skills with a single click. Supports Standard, Advantage, and Disadvantage modes.
- **Scaling Formula Parser**: Automatically calculates complex Nimble formulas like level-based damage scaling (e.g., `1d10 + (floor(LEVEL/5) * 5)`).
- **Attribute Specialization**: Easily toggle your "Key" (▲) and "Flaw" (▼) attributes to update all linked combat actions dynamically.
- **Bento-Style UI**: A clean, modern interface designed specifically for the OBR side panel, optimized for both desktop and laptop screens.
- **GM Tools**: GMs can view and edit any player's sheet, create custom items/spells, and manage the roll log.
- **Privacy & Ownership**: Sheets are tied to specific tokens and players to prevent accidental edits by others.

## Screenshots

<div align="center">
  <img src="https://nimble-obr.vercel.app/preview.gif" alt="Extension preview" height="450" />
</div>

## Technical Details

- **Support**: [GitHub Issues](https://github.com/Aur3liaP/nimble-obr/issues)
- **Framework**: React + TypeScript + Tailwind CSS