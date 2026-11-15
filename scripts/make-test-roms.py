"""Gera ROMs de teste minimas (homebrew proprio) para validar SRAM/save states.
Cada boot incrementa um contador na SRAM, entao da para ver se o save persistiu."""
import sys, os

LOGO = bytes.fromhex("CEED6666CC0D000B03730083000C000D0008111F8889000EDCCC6EE6DDDDD999BBBB67636E0EECCCDDDC999FBBB9333E")

def gb(title, cgb=False):
    rom = bytearray(32 * 1024)
    rom[0x100:0x104] = bytes([0x00, 0xC3, 0x50, 0x01])
    rom[0x104:0x134] = LOGO
    t = title.encode()[:11]
    rom[0x134:0x134 + len(t)] = t
    if cgb:
        rom[0x143] = 0x80
    rom[0x147] = 0x03  # MBC1+RAM+BATTERY
    rom[0x148] = 0x00
    rom[0x149] = 0x02  # 8KB RAM
    code = bytes([
        0x3E, 0x0A, 0xEA, 0x00, 0x00,        # enable RAM
        0xFA, 0x00, 0xA0, 0x3C, 0xEA, 0x00, 0xA0,  # [A000]++
        0x3E, 0x52, 0xEA, 0x01, 0xA0, 0x3E, 0x53, 0xEA, 0x02, 0xA0,  # "RS"
        # loop: le os botoes de acao (P1) e grava em A003 (0xDF solto, 0xDE com A apertado)
        0x3E, 0x10, 0xE0, 0x00, 0xF0, 0x00, 0xF0, 0x00, 0xEA, 0x03, 0xA0,
        0xFA, 0x04, 0xA0, 0x3C, 0xEA, 0x04, 0xA0,  # [A004]++ sem parar (testa se a SRAM segue sendo salva)
        0x18, 0xEC,
    ])
    rom[0x150:0x150 + len(code)] = code
    x = 0
    for i in range(0x134, 0x14D):
        x = (x - rom[i] - 1) & 0xFF
    rom[0x14D] = x
    return bytes(rom)

def gba(title):
    rom = bytearray(64 * 1024)
    # b 0x080000C0 ; loop forever at 0xC0 (writes SRAM byte)
    rom[0:4] = (0xEA00002E).to_bytes(4, "little")
    t = title.encode()[:12]
    rom[0xA0:0xA0 + len(t)] = t
    rom[0xAC:0xB0] = b"RSTE"
    rom[0xB0:0xB2] = b"01"
    rom[0xB2] = 0x96
    chk = 0
    for i in range(0xA0, 0xBD):
        chk = (chk - rom[i]) & 0xFF
    rom[0xBD] = (chk - 0x19) & 0xFF
    # ARM: mov r0,#0x0E000000 ; loop: ldrb r1,[r0] ; add r1,r1,#1 ; strb r1,[r0] ; b loop
    # (contador na SRAM que muda o tempo todo enquanto o jogo roda: serve para testar pausa)
    code = [0xE3A0040E, 0xE5D01000, 0xE2811001, 0xE5C01000, 0xEAFFFFFB]
    for n, w in enumerate(code):
        rom[0xC0 + 4 * n:0xC4 + 4 * n] = w.to_bytes(4, "little")
    rom[0x200:0x20B] = b"SRAM_V113\0\0"  # save-type hint
    return bytes(rom)

def snes(title):
    rom = bytearray(256 * 1024)
    code = bytes([0x78, 0x18, 0xFB,
                  0xAF, 0x00, 0x00, 0x70, 0x1A, 0x8F, 0x00, 0x00, 0x70,
                  0xA9, 0x52, 0x8F, 0x01, 0x00, 0x70,
                  0xAF, 0x02, 0x00, 0x70, 0x1A, 0x8F, 0x02, 0x00, 0x70,  # [$700002]++ sem parar
                  0x80, 0xF5])
    rom[0:len(code)] = code
    h = 0x7FC0
    t = title.encode()[:21].ljust(21, b" ")
    rom[h:h + 21] = t
    rom[h + 0x15] = 0x20
    rom[h + 0x16] = 0x02
    rom[h + 0x17] = 0x08
    rom[h + 0x18] = 0x01
    rom[0x7FFC:0x7FFE] = (0x8000).to_bytes(2, "little")
    rom[0x7FEA:0x7FEC] = (0x8000).to_bytes(2, "little")
    rom[0x7FDC:0x7FE0] = bytes([0xFF, 0xFF, 0, 0])
    s = sum(rom) & 0xFFFF
    rom[0x7FDE:0x7FE0] = s.to_bytes(2, "little")
    rom[0x7FDC:0x7FDE] = (s ^ 0xFFFF).to_bytes(2, "little")
    return bytes(rom)

out = sys.argv[1] if len(sys.argv) > 1 else "test-roms"
os.makedirs(out, exist_ok=True)
for name, data in [("Teste GB.gb", gb("TESTEGB")), ("Teste GBC.gbc", gb("TESTEGBC", True)),
                   ("Teste GBA.gba", gba("TESTEGBA")), ("Teste SNES.sfc", snes("TESTE SNES"))]:
    open(os.path.join(out, name), "wb").write(data)
    print("ok", name, len(data))
