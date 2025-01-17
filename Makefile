PYTHON_CMD := python3

run:
	${PYTHON_CMD} internal/server.py





### If you have python3.13, run 'make setup-py3' & 'make run-py3'
setup-py3:
	${PYTHON_CMD} -m venv internal/venv
	(\
	source internal/venv/bin/activate ;\
	pip install legacy-cgi\
	)

clean-py3:
	rm -rf internal/venv

run-py3:
	(\
	source internal/venv/bin/activate ;\
	python internal/server.py\
	)
