while > /dev/null inotifywait -q -r -e modify ${@:-src} ; do
    > /dev/null ./build.sh
    echo "Rebuilt $(date '+%H:%M:%S')"
done
