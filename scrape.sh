#!/bin/bash
set -e
export SHELL=/bin/bash
if [[ -e ~/.profile.d && -n "$(ls -A ~/.profile.d/)" ]]; then
  source <(cat $(find -L  ~/.profile.d -name '*.conf'))
fi
export DAF_BUTLER_REPOSITORY_INDEX=/sdf/group/rubin/g/data-repos.yaml
weekly=$(/usr/bin/ls -rd /cvmfs/sw.lsst.eu/almalinux-x86_64/lsst_distrib/w* | head -1)
source $weekly/loadLSST.sh
setup lsst_distrib -t w_latest
cd /sdf/data/rubin/u/jmeyers3/projects/aos/rubintv_guide
python scrape_blocks.py > /sdf/home/j/jmeyers3/public_html/rubintv_guide/scrape/scrape_blocks.log 2>&1
cp blocks.json /sdf/home/j/jmeyers3/public_html/rubintv_guide/blocks.json
cp tblock_names.json /sdf/home/j/jmeyers3/public_html/rubintv_guide/tblock_names.json
chmod o+g /sdf/home/j/jmeyers3/public_html/rubintv_guide/blocks.json
chmod o+g /sdf/home/j/jmeyers3/public_html/rubintv_guide/tblock_names.json
date >> /sdf/home/j/jmeyers3/public_html/rubintv_guide/scrape/last_updated.txt
