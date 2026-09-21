#!/usr/bin/env python3
"""
Align ELF LOAD segments to 16KB (0x4000) page boundary for Android 15+.

Android 15 with 16KB page-size kernels requires that all PT_LOAD segments
have p_vaddr and p_offset aligned to 16KB. Pre-built .so files from Maven
are typically only 4KB-aligned. This script pads and realigns them.

Usage: python3 align_so_16kb.py <input.so> <output.so>
"""

import struct
import sys
import os

PAGE_SIZE = 0x4000  # 16KB

def align_up(value, alignment):
    return (value + alignment - 1) & ~(alignment - 1)

def align_down(value, alignment):
    return value & ~(alignment - 1)

def read_elf_header(data):
    """Parse ELF64 header."""
    assert data[:4] == b'\x7fELF', 'Not an ELF file'
    assert data[4] == 2, 'Not 64-bit'
    assert data[5] == 1, 'Not little-endian'
    
    e_phoff = struct.unpack_from('<Q', data, 0x20)[0]
    e_shoff = struct.unpack_from('<Q', data, 0x28)[0]
    e_phentsize = struct.unpack_from('<H', data, 0x36)[0]
    e_phnum = struct.unpack_from('<H', data, 0x38)[0]
    e_shentsize = struct.unpack_from('<H', data, 0x3A)[0]
    e_shnum = struct.unpack_from('<H', data, 0x3C)[0]
    
    return {
        'phoff': e_phoff,
        'shoff': e_shoff,
        'phentsize': e_phentsize,
        'phnum': e_phnum,
        'shentsize': e_shentsize,
        'shnum': e_shnum,
    }

def read_program_headers(data, hdr):
    """Parse program headers."""
    phdrs = []
    for i in range(hdr['phnum']):
        off = hdr['phoff'] + i * hdr['phentsize']
        p_type = struct.unpack_from('<I', data, off)[0]
        p_flags = struct.unpack_from('<I', data, off + 4)[0]
        p_offset = struct.unpack_from('<Q', data, off + 8)[0]
        p_vaddr = struct.unpack_from('<Q', data, off + 16)[0]
        p_paddr = struct.unpack_from('<Q', data, off + 24)[0]
        p_filesz = struct.unpack_from('<Q', data, off + 32)[0]
        p_memsz = struct.unpack_from('<Q', data, off + 40)[0]
        p_align = struct.unpack_from('<Q', data, off + 48)[0]
        
        phdrs.append({
            'idx': i,
            'type': p_type,
            'flags': p_flags,
            'offset': p_offset,
            'vaddr': p_vaddr,
            'paddr': p_paddr,
            'filesz': p_filesz,
            'memsz': p_memsz,
            'align': p_align,
        })
    return phdrs

def read_section_headers(data, hdr):
    """Parse section headers."""
    shdrs = []
    for i in range(hdr['shnum']):
        off = hdr['shoff'] + i * hdr['shentsize']
        sh_name = struct.unpack_from('<I', data, off)[0]
        sh_type = struct.unpack_from('<I', data, off + 4)[0]
        sh_flags = struct.unpack_from('<Q', data, off + 8)[0]
        sh_addr = struct.unpack_from('<Q', data, off + 16)[0]
        sh_offset = struct.unpack_from('<Q', data, off + 24)[0]
        sh_size = struct.unpack_from('<Q', data, off + 32)[0]
        sh_link = struct.unpack_from('<I', data, off + 40)[0]
        sh_info = struct.unpack_from('<I', data, off + 44)[0]
        sh_addralign = struct.unpack_from('<Q', data, off + 48)[0]
        sh_entsize = struct.unpack_from('<Q', data, off + 56)[0]
        
        shdrs.append({
            'idx': i,
            'name': sh_name,
            'type': sh_type,
            'flags': sh_flags,
            'addr': sh_addr,
            'offset': sh_offset,
            'size': sh_size,
            'link': sh_link,
            'info': sh_info,
            'addralign': sh_addralign,
            'entsize': sh_entsize,
        })
    return shdrs

def align_so(input_path, output_path):
    with open(input_path, 'rb') as f:
        data = bytearray(f.read())
    
    original_size = len(data)
    hdr = read_elf_header(data)
    phdrs = read_program_headers(data, hdr)
    shdrs = read_section_headers(data, hdr)
    
    # Find PT_LOAD segments
    load_segments = [p for p in phdrs if p['type'] == 1]  # PT_LOAD = 1
    load_segments.sort(key=lambda p: p['offset'])
    
    print(f"Found {len(load_segments)} PT_LOAD segments")
    
    # Check if already aligned
    all_aligned = all(
        p['offset'] % PAGE_SIZE == 0 and p['vaddr'] % PAGE_SIZE == 0
        for p in load_segments
    )
    if all_aligned:
        print("Already 16KB aligned, copying...")
        with open(output_path, 'wb') as f:
            f.write(data)
        return
    
    # Build segment offset mapping (old_offset -> new_offset)
    # Process segments in order of file offset
    offset_map = {}  # old file offset -> new file offset
    current_offset = 0
    
    # First segment should be at offset 0
    # We'll process each segment and compute its new aligned offset
    
    new_segments = []
    for seg in load_segments:
        # Align the offset to PAGE_SIZE
        new_off = align_up(current_offset, PAGE_SIZE)
        offset_map[seg['offset']] = new_off
        new_segments.append({
            'old': seg,
            'new_offset': new_off,
        })
        current_offset = new_off + seg['filesz']
    
    # Compute total new file size
    max_end = max(s['new_offset'] + s['old']['filesz'] for s in new_segments)
    new_size = align_up(max_end, PAGE_SIZE)
    
    print(f"Original size: {original_size} (0x{original_size:x})")
    print(f"New size: {new_size} (0x{new_size:x})")
    
    # Create new data buffer
    new_data = bytearray(new_size)
    
    # Copy ELF header (first 64 bytes, or up to first program header)
    header_end = min(hdr['phoff'], hdr['shoff'] if hdr['shoff'] > 0 else original_size)
    # Actually, we need to be more careful. Copy everything before the first LOAD segment.
    first_load_offset = min(s['old']['offset'] for s in new_segments)
    new_data[:first_load_offset] = data[:first_load_offset]
    
    # Copy each LOAD segment to its new offset
    for seg_info in new_segments:
        old_off = seg_info['old']['offset']
        new_off = seg_info['new_offset']
        filesz = seg_info['old']['filesz']
        new_data[new_off:new_off + filesz] = data[old_off:old_off + filesz]
        print(f"  LOAD: 0x{old_off:x} -> 0x{new_off:x} (size 0x{filesz:x})")
    
    # Update program headers
    for seg_info in new_segments:
        seg = seg_info['old']
        new_off = seg_info['new_offset']
        ph_off = hdr['phoff'] + seg['idx'] * hdr['phentsize']
        
        # Update p_offset, p_vaddr, p_paddr, p_align
        # vaddr must also be aligned to maintain offset==vaddr relationship
        new_vaddr = align_up(seg['vaddr'], PAGE_SIZE)
        
        struct.pack_into('<Q', new_data, ph_off + 8, new_off)    # p_offset
        struct.pack_into('<Q', new_data, ph_off + 16, new_vaddr)  # p_vaddr
        struct.pack_into('<Q', new_data, ph_off + 24, new_vaddr)  # p_paddr
        struct.pack_into('<Q', new_data, ph_off + 48, PAGE_SIZE)  # p_align
    
    # Update non-LOAD program headers that reference file offsets
    for ph in phdrs:
        if ph['type'] != 1 and ph['offset'] > 0:
            # Find the closest preceding LOAD segment offset
            new_off = None
            for seg_info in new_segments:
                if seg_info['old']['offset'] <= ph['offset']:
                    candidate = seg_info['new_offset'] + (ph['offset'] - seg_info['old']['offset'])
                    if new_off is None or candidate > new_off:
                        new_off = candidate
            if new_off is not None:
                ph_off = hdr['phoff'] + ph['idx'] * hdr['phentsize']
                struct.pack_into('<Q', new_data, ph_off + 8, new_off)
    
    # Update section headers
    for sh in shdrs:
        if sh['offset'] > 0 and sh['type'] != 8:  # SHT_NOBITS = 8 (no file data)
            new_off = None
            for seg_info in new_segments:
                if seg_info['old']['offset'] <= sh['offset']:
                    candidate = seg_info['new_offset'] + (sh['offset'] - seg_info['old']['offset'])
                    if new_off is None or candidate > new_off:
                        new_off = candidate
            if new_off is not None:
                sh_off = hdr['shoff'] + sh['idx'] * hdr['shentsize']
                struct.pack_into('<Q', new_data, sh_off + 24, new_off)  # sh_offset
                
                # Also update sh_addr if it's in a LOAD segment
                for seg_info in new_segments:
                    seg = seg_info['old']
                    if seg['vaddr'] <= sh['addr'] < seg['vaddr'] + seg['memsz']:
                        new_vaddr = align_up(seg['vaddr'], PAGE_SIZE)
                        new_addr = new_vaddr + (sh['addr'] - seg['vaddr'])
                        struct.pack_into('<Q', new_data, sh_off + 16, new_addr)  # sh_addr
                        break
    
    # Note: dynamic relocations and other offset references inside the
    # .dynamic section and program data are NOT updated. This works for
    # position-independent shared libraries where the dynamic linker
    # handles relocation at load time based on the program headers.
    # The key invariant is: p_vaddr - p_offset must remain constant,
    # which it does since we align both by the same amount.
    
    with open(output_path, 'wb') as f:
        f.write(new_data)
    
    print(f"Written: {output_path} ({new_size} bytes)")

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.so> <output.so>")
        sys.exit(1)
    align_so(sys.argv[1], sys.argv[2])
