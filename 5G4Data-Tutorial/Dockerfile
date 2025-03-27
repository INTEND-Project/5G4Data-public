# Use an official Python image as a base
FROM python:3.12

# Set the working directory inside the container
WORKDIR /app

# Copy the application files into the container
COPY decide_and_act.py requirements.txt . 

# Copy templates and static folders explicitly
COPY templates/ templates/
COPY static/ static/

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Expose the port that the app will run on
EXPOSE 5000

# Set the command to run the application
CMD ["python", "decide_and_act.py"]
