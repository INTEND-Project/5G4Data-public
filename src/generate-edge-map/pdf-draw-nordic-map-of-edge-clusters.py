import pandas as pd
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature

# Load the city coordinates from CSV
def load_city_coordinates(csv_filename):
    df = pd.read_csv(csv_filename)
    return df

# Function to plot cities using Mercator projection and save as PDF
def plot_nordic_cities(df, output_pdf="nordic_cities_mercator.pdf"):
    # Create the plot with Mercator projection
    fig, ax = plt.subplots(figsize=(10, 12), subplot_kw={"projection": ccrs.Mercator()})

    # Add country borders and coastlines
    ax.add_feature(cfeature.BORDERS, linewidth=1)
    ax.add_feature(cfeature.COASTLINE, linewidth=1)
    ax.set_extent([-20, 40, 54, 82], crs=ccrs.PlateCarree())  # Adjusted to include Spitsbergen (Svalbard)

    # Plot cities
    for _, row in df.iterrows():
        ax.scatter(row["Longitude"], row["Latitude"], color="red", s=50, edgecolor="black", 
                   transform=ccrs.PlateCarree(), zorder=3)
        # ax.text(row["Longitude"] + 0.5, row["Latitude"], row["City"], fontsize=9, 
        #         transform=ccrs.PlateCarree(), zorder=3)

    plt.title("Telnor Edge data centers in the Nordic Region (Mercator Projection)")

    # Save the plot as a PDF
    plt.savefig(output_pdf, format="png", bbox_inches="tight")
    print(f"Map saved as {output_pdf}")

# Main function
def main():
    csv_filename = "../../tmp/cities_lat_lon.csv"  # Ensure your CSV file is in the correct location
    output_pdf = "../../generated-syntetic-data/Nordic_Cities_Mercator.png"  # Define output PDF file name
    df = load_city_coordinates(csv_filename)
    plot_nordic_cities(df, output_pdf)

if __name__ == "__main__":
    main()
