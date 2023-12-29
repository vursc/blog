mkdir -p docs
rm -rf docs/*

if [ "$1" = copy ]; then
  cp -r res static docs/
else
  ln -sr res static docs/
fi

node mk/build.mjs
