setup:
	python3 -m venv internal/venv
	(\
	source internal/venv/bin/activate ;\
	pip install legacy-cgi\
	)

run:
	(\
	source internal/venv/bin/activate ;\
	python internal/server.py\
	)